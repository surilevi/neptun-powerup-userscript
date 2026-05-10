// ==UserScript==
// @name         Neptun PowerUp!
// @namespace    npu
// @version      3.1.2
// @author       Neptun PowerUp! Contributors
// @description  Neptun helper userscript for course and exam workflows
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neptun.net
// @match        https://*/hallgato*/*
// @match        https://*/ujhallgato/*
// @grant        GM.getValue
// @grant        GM.info
// @grant        GM.setValue
// ==/UserScript==

(function () {
  'use strict';

  function createEventBus() {
    const handlers = new Map();
    const wildcards = new Map();
    function on(event, handler) {
      if (event.endsWith(":*")) {
        const ns = event.slice(0, -2);
        if (!wildcards.has(ns)) wildcards.set(ns, new Set());
        wildcards.get(ns).add(handler);
        return () => wildcards.get(ns)?.delete(handler);
      }
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    }
    function off(event, handler) {
      if (event.endsWith(":*")) {
        const ns = event.slice(0, -2);
        wildcards.get(ns)?.delete(handler);
      } else {
        handlers.get(event)?.delete(handler);
      }
    }
    function emit(event, payload) {
      handlers.get(event)?.forEach((h) => {
        try {
          h(payload);
        } catch (err) {
          console.error("[NPU:event-bus] handler error:", err);
        }
      });
      const ns = event.split(":")[0];
      wildcards.get(ns)?.forEach((h) => {
        try {
          h(payload);
        } catch (err) {
          console.error("[NPU:event-bus] wildcard handler error:", err);
        }
      });
    }
    return { on, off, emit };
  }
  const DEBUG_STORAGE_KEY = "npu_debug";
  const DEBUG_MESSAGE_TAGS = [
    "[dom-debug]",
    "[session-debug]",
    "[enroll-debug]",
    "[exam-enroll-debug]",
    "[exam-dom-debug]",
    "[interceptor-debug]"
  ];
  function isDebugEnabled() {
    try {
      return window.localStorage.getItem(DEBUG_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  }
  function isDebugMessage(args) {
    for (const arg of args) {
      if (typeof arg !== "string") continue;
      if (DEBUG_MESSAGE_TAGS.some((tag) => arg.includes(tag))) {
        return true;
      }
    }
    return false;
  }
  function createLogger(namespace) {
    const prefix = `[NPU:${namespace}]`;
    return {
      info: (...args) => {
        if (!isDebugEnabled()) return;
        console.log(prefix, ...args);
      },
      warn: (...args) => {
        if (!isDebugEnabled() && isDebugMessage(args)) return;
        console.warn(prefix, ...args);
      },
      error: (...args) => console.error(prefix, ...args)
    };
  }
  function createStorageService(gm, domain) {
    async function loadAll() {
      const raw = await gm.getValue("npu3");
      if (!raw) return {};
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.error("[NPU:storage] failed to parse stored data:", err);
        return {};
      }
    }
    async function saveAll(data) {
      try {
        await gm.setValue("npu3", JSON.stringify(data));
      } catch (err) {
        console.error("[NPU:storage] failed to save data:", err);
      }
    }
    return {
      async get(key) {
        const data = await loadAll();
        return data[key];
      },
      async set(key, value) {
        const data = await loadAll();
        data[key] = value;
        await saveAll(data);
      },
      async remove(key) {
        const data = await loadAll();
        delete data[key];
        await saveAll(data);
      },
      async getForDomain(key) {
        const data = await loadAll();
        const domainData = data[`domain:${domain}`] ?? {};
        return domainData[key];
      },
      async setForDomain(key, value) {
        const data = await loadAll();
        const domainData = data[`domain:${domain}`] ?? {};
        domainData[key] = value;
        data[`domain:${domain}`] = domainData;
        await saveAll(data);
      }
    };
  }
  function createModuleRegistry(bus, gmStorage, statusPanel) {
    const modules = [];
    const activated = new Set();
    let isActivating = false;
    const panel = statusPanel ?? {
      setSessionStatus: () => {
      },
      addMessage: () => {
      },
      setModuleContent: () => {
      },
      setModuleContentElement: () => {
      },
      expand: () => {
      },
      collapse: () => {
      },
      toggle: () => {
      },
      isExpanded: () => false,
      getCourseRushMode: () => false,
      setCourseRushMode: () => {
      },
      getExamRushMode: () => false,
      setExamRushMode: () => {
      },
      getThemeSettings: () => ({ enabled: false, color: "pink" }),
      setThemeSettings: () => {
      },
      onThemeSettingsChange: () => () => {
      },
      dispose: () => {
      }
    };
    function register(module) {
      modules.push(module);
    }
    async function activateAll(context) {
      if (isActivating) return;
      isActivating = true;
      try {
        for (const mod of modules) {
          if (activated.has(mod.id)) continue;
          if (!mod.shouldActivate(context)) continue;
          const logger = createLogger(mod.id);
          const storage = createStorageService(
            gmStorage ?? { getValue: async () => void 0, setValue: async () => {
            } },
            context.domain
          );
          const api2 = { bus, storage, logger, statusPanel: panel };
          try {
            await mod.initialize(api2);
            activated.add(mod.id);
            logger.info("activated");
          } catch (error) {
            bus.emit("module:error", { moduleId: mod.id, error });
            logger.error("failed to activate:", error);
          }
        }
      } finally {
        isActivating = false;
      }
    }
    function disposeAll() {
      for (const mod of modules) {
        if (!activated.has(mod.id)) continue;
        activated.delete(mod.id);
        try {
          mod.dispose?.();
        } catch (error) {
          const logger = createLogger(mod.id);
          logger.error("failed to dispose:", error);
        }
      }
    }
    return { register, activateAll, disposeAll };
  }
  const STYLE_ID = "npu-theme-mode";
  const THEME_PRESETS = [
    { name: "Pink", key: "pink", primary: "#e91e63", dark: "#880e4f", light: "#f48fb1", bgTint: "#fdf2f6", link: "#c2185b", tableHeader: "#ec407a", footerText: "#fce4ec" },
    { name: "Purple", key: "purple", primary: "#9c27b0", dark: "#4a148c", light: "#ce93d8", bgTint: "#f3e5f5", link: "#7b1fa2", tableHeader: "#ab47bc", footerText: "#e1bee7" },
    { name: "Teal", key: "teal", primary: "#009688", dark: "#004d40", light: "#80cbc4", bgTint: "#e0f2f1", link: "#00796b", tableHeader: "#26a69a", footerText: "#b2dfdb" },
    { name: "Orange", key: "orange", primary: "#ff5722", dark: "#bf360c", light: "#ffab91", bgTint: "#fbe9e7", link: "#e64a19", tableHeader: "#ff7043", footerText: "#ffccbc" },
    { name: "Red", key: "red", primary: "#f44336", dark: "#b71c1c", light: "#ef9a9a", bgTint: "#ffebee", link: "#d32f2f", tableHeader: "#ef5350", footerText: "#ffcdd2" }
  ];
  const DEFAULT_THEME = { enabled: false, color: "pink" };
  const THEME_CSS = `
/* NPU Theme Mode — accent colors via CSS custom properties */
/* Rule: ONLY color accents. Don't change backgrounds of content areas. */
/* Rule: NEVER touch #npu-status-root */

body:not(#npu-status-root) {
  background-color: var(--npu-bg-tint) !important;
}

neptun-header,
neptun-header header,
neptun-header .header,
neptun-header .header__inner {
  background-color: var(--npu-accent) !important;
  color: white !important;
}

footer {
  background-color: var(--npu-accent-dark) !important;
  color: var(--npu-footer-text) !important;
}

button[type="submit"],
button[color="primary"],
.mat-mdc-raised-button[color="primary"],
.mat-mdc-unelevated-button[color="primary"] {
  background-color: var(--npu-accent) !important;
  color: white !important;
}

table th,
.mat-mdc-header-cell {
  background-color: var(--npu-table-header) !important;
  color: white !important;
}

a:not(#npu-status-root a) {
  color: var(--npu-link) !important;
}

.mdc-checkbox--selected .mdc-checkbox__background {
  background-color: var(--npu-accent) !important;
  border-color: var(--npu-accent) !important;
}

mat-expansion-panel {
  border-left: 3px solid var(--npu-accent-light) !important;
}

::-webkit-scrollbar-thumb {
  background: var(--npu-accent-light) !important;
}

.mat-mdc-badge-content {
  background-color: var(--npu-accent) !important;
}
`;
  let api$3 = null;
  let styleElement = null;
  let unsubTheme = null;
  function getPreset(key) {
    return THEME_PRESETS.find((p) => p.key === key) ?? THEME_PRESETS[0];
  }
  function setCustomProperties(preset) {
    const root = document.documentElement;
    root.style.setProperty("--npu-accent", preset.primary);
    root.style.setProperty("--npu-accent-dark", preset.dark);
    root.style.setProperty("--npu-accent-light", preset.light);
    root.style.setProperty("--npu-bg-tint", preset.bgTint);
    root.style.setProperty("--npu-link", preset.link);
    root.style.setProperty("--npu-table-header", preset.tableHeader);
    root.style.setProperty("--npu-footer-text", preset.footerText);
  }
  function clearCustomProperties() {
    const root = document.documentElement;
    root.style.removeProperty("--npu-accent");
    root.style.removeProperty("--npu-accent-dark");
    root.style.removeProperty("--npu-accent-light");
    root.style.removeProperty("--npu-bg-tint");
    root.style.removeProperty("--npu-link");
    root.style.removeProperty("--npu-table-header");
    root.style.removeProperty("--npu-footer-text");
  }
  function inject(preset) {
    setCustomProperties(preset);
    if (document.getElementById(STYLE_ID)) return;
    styleElement = document.createElement("style");
    styleElement.id = STYLE_ID;
    styleElement.textContent = THEME_CSS;
    document.head.appendChild(styleElement);
  }
  function remove() {
    styleElement?.remove();
    styleElement = null;
    document.getElementById(STYLE_ID)?.remove();
    clearCustomProperties();
  }
  const pinkModeModule = {
    id: "pink-mode",
    name: "Theme",
    description: "Color accent theme for Neptun",
    shouldActivate(_context) {
      return true;
    },
    initialize(moduleApi) {
      api$3 = moduleApi;
      const settings = api$3.statusPanel.getThemeSettings();
      if (settings.enabled) {
        const preset = getPreset(settings.color);
        inject(preset);
        api$3.logger.info(`theme activated: ${preset.name}`);
      }
      unsubTheme = api$3.statusPanel.onThemeSettingsChange((newSettings) => {
        if (newSettings.enabled) {
          const preset = getPreset(newSettings.color);
          inject(preset);
          api$3?.logger.info(`theme changed to ${preset.name}`);
        } else {
          remove();
          api$3?.logger.info("theme deactivated");
        }
      });
    },
    dispose() {
      unsubTheme?.();
      unsubTheme = null;
      remove();
      api$3 = null;
    }
  };
  const MAX_MESSAGES = 5;
  const COLORS = {
    bg: "#16213e",
    bgDark: "#1a1a2e",
    text: "#e0e0e0",
    textMuted: "#9e9e9e",
    accent: "#5c9eff",
    border: "#2a2a4a",
    green: "#4caf50",
    yellow: "#ff9800",
    red: "#f44336"
  };
  function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
  }
  function formatTime(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }
  function formatCountdown(ms) {
    if (ms <= 0) return "0s";
    const totalSec = Math.ceil(ms / 1e3);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return min > 0 ? `${min}m ${pad2(sec)}s` : `${sec}s`;
  }
  function levelIcon(level) {
    switch (level) {
      case "info":
        return "✓";
case "warn":
        return "⚠";
case "error":
        return "✕";
    }
  }
  function levelColor(level) {
    switch (level) {
      case "info":
        return COLORS.green;
      case "warn":
        return COLORS.yellow;
      case "error":
        return COLORS.red;
    }
  }
  function createStatusPanel(bus, rushCallbacks, rushInitial, themeInitial) {
    let expanded = false;
    let sessionState = "active";
    let sessionRemainingMs = 0;
    let countdownTimer = null;
    let flashTimer = null;
    let isFlashing = false;
    const messages = [];
    const unsubs = [];
    let courseRushOn = rushInitial?.courseRush ?? false;
    let examRushOn = rushInitial?.examRush ?? false;
    let settingsVisible = false;
    let settingsContainer = null;
    let normalContent = null;
    let gearBtn = null;
    let titleSpanRef = null;
    let themeSettings = themeInitial ? { ...themeInitial } : { ...DEFAULT_THEME };
    const themeChangeCallbacks = [];
    let root = null;
    let badge = null;
    let badgeDot = null;
    let panel = null;
    let headerDot = null;
    let sessionLine = null;
    let messageList = null;
    let moduleSection = null;
    let minimizeBtn = null;
    let courseRushToggle = null;
    let examRushToggle = null;
    function build() {
      root = document.createElement("div");
      root.id = "npu-status-root";
      root.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 99999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: ${COLORS.text};
      line-height: 1.4;
    `;
      badge = document.createElement("div");
      badge.id = "npu-badge";
      badge.style.cssText = `
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background: ${COLORS.bgDark};
      border: 1px solid ${COLORS.border};
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0.85;
      transition: opacity 0.2s;
      position: relative;
      user-select: none;
    `;
      badge.addEventListener("mouseenter", () => {
        if (badge) badge.style.opacity = "1";
      });
      badge.addEventListener("mouseleave", () => {
        if (badge) badge.style.opacity = "0.85";
      });
      const badgeLabel = document.createElement("span");
      badgeLabel.style.cssText = `
      font-size: 11px;
      font-weight: 700;
      color: ${COLORS.accent};
      letter-spacing: 0.5px;
    `;
      badgeLabel.textContent = "NPU";
      badge.appendChild(badgeLabel);
      badgeDot = document.createElement("span");
      badgeDot.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: ${COLORS.green};
    `;
      badge.appendChild(badgeDot);
      badge.addEventListener("click", () => toggle());
      root.appendChild(badge);
      panel = document.createElement("div");
      panel.id = "npu-panel";
      panel.style.cssText = `
      width: 320px;
      max-height: 400px;
      overflow-y: auto;
      background: ${COLORS.bg};
      border: 1px solid ${COLORS.border};
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: none;
      flex-direction: column;
    `;
      const header = document.createElement("div");
      header.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
    `;
      titleSpanRef = document.createElement("span");
      titleSpanRef.style.cssText = `
      font-weight: 700;
      font-size: 14px;
      color: ${COLORS.accent};
      flex: 1;
    `;
      titleSpanRef.textContent = "Neptun PowerUp!";
      header.appendChild(titleSpanRef);
      headerDot = document.createElement("span");
      headerDot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: ${COLORS.green};
      margin-right: 10px;
    `;
      header.appendChild(headerDot);
      gearBtn = document.createElement("button");
      gearBtn.style.cssText = `
      background: none;
      border: none;
      color: ${COLORS.textMuted};
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
      line-height: 1;
      margin-right: 6px;
    `;
      gearBtn.textContent = "⚙";
      gearBtn.title = "Settings";
      gearBtn.addEventListener("click", () => toggleSettings());
      header.appendChild(gearBtn);
      minimizeBtn = document.createElement("button");
      minimizeBtn.style.cssText = `
      background: none;
      border: none;
      color: ${COLORS.textMuted};
      cursor: pointer;
      font-size: 16px;
      padding: 0 2px;
      line-height: 1;
    `;
      minimizeBtn.textContent = "✕";
      minimizeBtn.addEventListener("click", () => collapse());
      header.appendChild(minimizeBtn);
      panel.appendChild(header);
      const sessionSection = document.createElement("div");
      sessionSection.style.cssText = `
      padding: 8px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
    `;
      sessionLine = document.createElement("div");
      sessionLine.style.cssText = `
      font-size: 12px;
      color: ${COLORS.textMuted};
    `;
      sessionLine.textContent = "Session: waiting for token...";
      sessionSection.appendChild(sessionLine);
      const rushSection = document.createElement("div");
      rushSection.style.cssText = `
      padding: 8px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
      display: flex;
      gap: 14px;
      align-items: center;
    `;
      const styleEl = document.createElement("style");
      styleEl.textContent = `
      @keyframes npu-pulse {
        0%, 100% { box-shadow: 0 0 4px rgba(92, 158, 255, 0.3); }
        50% { box-shadow: 0 0 12px rgba(92, 158, 255, 0.8); }
      }
      .npu-rush-toggle {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 11px;
        color: ${COLORS.textMuted};
        user-select: none;
      }
      .npu-rush-toggle input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
      }
      .npu-rush-track {
        position: relative;
        width: 30px;
        height: 16px;
        background: #555;
        border-radius: 8px;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .npu-rush-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 12px;
        height: 12px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
      }
      .npu-rush-toggle input:checked + .npu-rush-track {
        background: ${COLORS.green};
      }
      .npu-rush-toggle input:checked + .npu-rush-track::after {
        transform: translateX(14px);
      }
    `;
      rushSection.appendChild(styleEl);
      const courseLabel = document.createElement("label");
      courseLabel.className = "npu-rush-toggle";
      courseLabel.title = "After login, open course registration and enroll saved courses";
      courseRushToggle = document.createElement("input");
      courseRushToggle.type = "checkbox";
      courseRushToggle.checked = courseRushOn;
      courseRushToggle.addEventListener("change", () => {
        courseRushOn = courseRushToggle.checked;
        updateDots();
        rushCallbacks?.onCourseRushChange(courseRushOn);
      });
      const courseTrack = document.createElement("span");
      courseTrack.className = "npu-rush-track";
      const courseLabelText = document.createElement("span");
      courseLabelText.textContent = "Course Rush";
      courseLabel.appendChild(courseRushToggle);
      courseLabel.appendChild(courseTrack);
      courseLabel.appendChild(courseLabelText);
      rushSection.appendChild(courseLabel);
      const examLabel = document.createElement("label");
      examLabel.className = "npu-rush-toggle";
      examLabel.title = "After login, open exams and enroll saved dates";
      examRushToggle = document.createElement("input");
      examRushToggle.type = "checkbox";
      examRushToggle.checked = examRushOn;
      examRushToggle.addEventListener("change", () => {
        examRushOn = examRushToggle.checked;
        updateDots();
        rushCallbacks?.onExamRushChange(examRushOn);
      });
      const examTrack = document.createElement("span");
      examTrack.className = "npu-rush-track";
      const examLabelText = document.createElement("span");
      examLabelText.textContent = "Exam Rush";
      examLabel.appendChild(examRushToggle);
      examLabel.appendChild(examTrack);
      examLabel.appendChild(examLabelText);
      rushSection.appendChild(examLabel);
      const messageFeedSection = document.createElement("div");
      messageFeedSection.style.cssText = `
      padding: 6px 14px;
      max-height: 120px;
      overflow-y: auto;
      flex-shrink: 0;
    `;
      messageList = document.createElement("div");
      messageList.id = "npu-messages";
      messageFeedSection.appendChild(messageList);
      moduleSection = document.createElement("div");
      moduleSection.id = "npu-module-section";
      moduleSection.style.cssText = `
      padding: 8px 14px;
      flex-shrink: 0;
    `;
      normalContent = document.createElement("div");
      normalContent.id = "npu-normal-content";
      normalContent.appendChild(sessionSection);
      normalContent.appendChild(rushSection);
      normalContent.appendChild(messageFeedSection);
      normalContent.appendChild(moduleSection);
      panel.appendChild(normalContent);
      settingsContainer = document.createElement("div");
      settingsContainer.id = "npu-settings";
      settingsContainer.style.cssText = `padding: 12px 14px; display: none;`;
      buildSettingsContent(settingsContainer);
      panel.appendChild(settingsContainer);
      root.appendChild(panel);
      try {
        document.body.appendChild(root);
      } catch {
        document.addEventListener("DOMContentLoaded", () => {
          if (root && !root.parentNode) {
            document.body.appendChild(root);
          }
        });
      }
    }
    function buildSettingsContent(container) {
      const appearanceHeader = document.createElement("div");
      appearanceHeader.style.cssText = `color: ${COLORS.accent}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;`;
      appearanceHeader.textContent = "Appearance";
      container.appendChild(appearanceHeader);
      const themeRow = document.createElement("div");
      themeRow.style.cssText = "display: flex; align-items: center; gap: 10px; margin-bottom: 8px;";
      const themeLabel = document.createElement("label");
      themeLabel.className = "npu-rush-toggle";
      const themeCheckbox = document.createElement("input");
      themeCheckbox.type = "checkbox";
      themeCheckbox.checked = themeSettings.enabled;
      const themeTrack = document.createElement("span");
      themeTrack.className = "npu-rush-track";
      const themeLabelText = document.createElement("span");
      themeLabelText.textContent = "Theme";
      themeLabel.appendChild(themeCheckbox);
      themeLabel.appendChild(themeTrack);
      themeLabel.appendChild(themeLabelText);
      themeRow.appendChild(themeLabel);
      const colorRow = document.createElement("div");
      colorRow.style.cssText = "display: flex; gap: 6px; margin-left: auto;";
      function updateColorCircles() {
        colorRow.querySelectorAll(".npu-color-circle").forEach((el) => {
          const circle = el;
          const isActive = circle.dataset.color === themeSettings.color;
          circle.style.border = isActive ? "2px solid white" : "2px solid transparent";
          circle.style.transform = isActive ? "scale(1.15)" : "scale(1)";
        });
      }
      for (const preset of THEME_PRESETS) {
        const circle = document.createElement("div");
        circle.className = "npu-color-circle";
        circle.dataset.color = preset.key;
        circle.title = preset.name;
        circle.style.cssText = `
        width: 18px; height: 18px; border-radius: 50%;
        background: ${preset.primary}; cursor: pointer;
        transition: transform 0.15s, border 0.15s;
        border: 2px solid ${themeSettings.color === preset.key ? "white" : "transparent"};
        transform: ${themeSettings.color === preset.key ? "scale(1.15)" : "scale(1)"};
      `;
        circle.addEventListener("click", () => {
          themeSettings.color = preset.key;
          if (!themeSettings.enabled) {
            themeSettings.enabled = true;
            themeCheckbox.checked = true;
          }
          updateColorCircles();
          notifyThemeChange();
        });
        colorRow.appendChild(circle);
      }
      themeCheckbox.addEventListener("change", () => {
        themeSettings.enabled = themeCheckbox.checked;
        notifyThemeChange();
      });
      themeRow.appendChild(colorRow);
      container.appendChild(themeRow);
      const legalHeader = document.createElement("div");
      legalHeader.style.cssText = `color: ${COLORS.accent}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 16px; margin-bottom: 10px; padding-top: 12px; border-top: 1px solid ${COLORS.border};`;
      legalHeader.textContent = "Consent";
      container.appendChild(legalHeader);
      const resetBtn = document.createElement("button");
      resetBtn.style.cssText = `padding: 5px 12px; background: transparent; color: ${COLORS.red}; border: 1px solid ${COLORS.red}; border-radius: 4px; cursor: pointer; font-size: 11px;`;
      resetBtn.textContent = "Show Consent Again";
      resetBtn.addEventListener("click", async () => {
        rushCallbacks?.onConsentReset?.();
        resetBtn.textContent = "Consent will show again";
        resetBtn.style.color = COLORS.green;
        resetBtn.style.borderColor = COLORS.green;
        setTimeout(() => {
          resetBtn.textContent = "Show Consent Again";
          resetBtn.style.color = COLORS.red;
          resetBtn.style.borderColor = COLORS.red;
        }, 2e3);
      });
      container.appendChild(resetBtn);
      const resetNote = document.createElement("div");
      resetNote.style.cssText = `font-size: 10px; color: #666; margin-top: 4px;`;
      resetNote.textContent = "The consent prompt appears on the next page load";
      container.appendChild(resetNote);
    }
    function notifyThemeChange() {
      const copy = { ...themeSettings };
      for (const cb of themeChangeCallbacks) cb(copy);
      rushCallbacks?.onThemeChange?.(copy);
    }
    function toggleSettings() {
      settingsVisible = !settingsVisible;
      if (normalContent) normalContent.style.display = settingsVisible ? "none" : "block";
      if (settingsContainer) settingsContainer.style.display = settingsVisible ? "block" : "none";
      if (titleSpanRef)
        titleSpanRef.textContent = settingsVisible ? "⚙ Settings" : "Neptun PowerUp!";
    }
    function dotColor() {
      if (isFlashing) return COLORS.red;
      switch (sessionState) {
        case "active":
          return COLORS.green;
        case "expiring":
          return COLORS.yellow;
        case "expired":
          return COLORS.red;
        case "refreshing":
          return COLORS.yellow;
      }
    }
    function updateDots() {
      const color = dotColor();
      if (badgeDot) badgeDot.style.background = color;
      if (headerDot) headerDot.style.background = color;
      if (badge) {
        if (courseRushOn || examRushOn) {
          badge.style.animation = "npu-pulse 2s ease-in-out infinite";
        } else {
          badge.style.animation = "";
        }
      }
    }
    function renderSessionLine() {
      if (!sessionLine) return;
      switch (sessionState) {
        case "active":
          sessionLine.textContent = sessionRemainingMs > 0 ? `Session: ${formatCountdown(sessionRemainingMs)}` : "Session: active";
          sessionLine.style.color = COLORS.text;
          break;
        case "expiring":
          sessionLine.textContent = `Session: ${formatCountdown(sessionRemainingMs)} (expiring)`;
          sessionLine.style.color = COLORS.yellow;
          break;
        case "expired":
          sessionLine.textContent = "Session expired";
          sessionLine.style.color = COLORS.red;
          break;
        case "refreshing":
          sessionLine.textContent = "Session: refreshing...";
          sessionLine.style.color = COLORS.yellow;
          break;
      }
    }
    function renderMessages() {
      if (!messageList) return;
      while (messageList.firstChild) messageList.removeChild(messageList.firstChild);
      if (messages.length === 0) return;
      for (const entry of messages) {
        const row = document.createElement("div");
        row.style.cssText = `
        font-size: 11px;
        padding: 2px 0;
        display: flex;
        gap: 6px;
        align-items: baseline;
      `;
        const icon = document.createElement("span");
        icon.textContent = levelIcon(entry.level);
        icon.style.color = levelColor(entry.level);
        icon.style.flexShrink = "0";
        row.appendChild(icon);
        const text = document.createElement("span");
        text.style.cssText = `flex: 1; word-break: break-word;`;
        text.textContent = entry.text;
        row.appendChild(text);
        const time = document.createElement("span");
        time.style.cssText = `
        color: ${COLORS.textMuted};
        font-size: 10px;
        flex-shrink: 0;
      `;
        time.textContent = entry.time;
        row.appendChild(time);
        messageList.appendChild(row);
      }
    }
    function startCountdown() {
      stopCountdown();
      countdownTimer = setInterval(() => {
        if (sessionState === "active" || sessionState === "expiring") {
          sessionRemainingMs = Math.max(0, sessionRemainingMs - 1e3);
          if (sessionRemainingMs <= 6e4 && sessionState === "active") {
            sessionState = "expiring";
            updateDots();
          }
          if (sessionRemainingMs <= 0) {
            sessionState = "expired";
            updateDots();
          }
          renderSessionLine();
        }
      }, 1e3);
    }
    function stopCountdown() {
      if (countdownTimer !== null) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
    function flashBadge() {
      if (isFlashing) return;
      isFlashing = true;
      updateDots();
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        isFlashing = false;
        updateDots();
        flashTimer = null;
      }, 3e3);
    }
    function setSessionStatus(state, remainingMs) {
      sessionState = state;
      if (remainingMs !== void 0) {
        sessionRemainingMs = remainingMs;
      }
      updateDots();
      renderSessionLine();
      if ((state === "active" || state === "expiring") && sessionRemainingMs > 0) {
        startCountdown();
      }
    }
    function addMessage(level, text) {
      const entry = {
        level,
        text,
        time: formatTime( new Date())
      };
      messages.unshift(entry);
      if (messages.length > MAX_MESSAGES) messages.pop();
      renderMessages();
      if (level === "error" || level === "warn") {
        flashBadge();
      }
    }
    function setModuleContent(text) {
      if (!moduleSection) return;
      moduleSection.textContent = text;
    }
    function setModuleContentElement(element) {
      if (!moduleSection) return;
      if (settingsVisible) {
        settingsVisible = false;
        if (normalContent) normalContent.style.display = "block";
        if (settingsContainer) settingsContainer.style.display = "none";
        if (titleSpanRef) titleSpanRef.textContent = "Neptun PowerUp!";
      }
      while (moduleSection.firstChild) moduleSection.removeChild(moduleSection.firstChild);
      moduleSection.appendChild(element);
    }
    function expand() {
      if (expanded) return;
      expanded = true;
      if (badge) badge.style.display = "none";
      if (panel) panel.style.display = "flex";
    }
    function collapse() {
      if (!expanded) return;
      expanded = false;
      if (settingsVisible) {
        settingsVisible = false;
        if (normalContent) normalContent.style.display = "block";
        if (settingsContainer) settingsContainer.style.display = "none";
        if (titleSpanRef) titleSpanRef.textContent = "Neptun PowerUp!";
      }
      if (badge) badge.style.display = "flex";
      if (panel) panel.style.display = "none";
    }
    function toggle() {
      if (expanded) collapse();
      else expand();
    }
    function isExpandedFn() {
      return expanded;
    }
    function getCourseRushMode() {
      return courseRushOn;
    }
    function setCourseRushModeValue(on) {
      courseRushOn = on;
      if (courseRushToggle) courseRushToggle.checked = on;
      updateDots();
    }
    function getExamRushMode() {
      return examRushOn;
    }
    function setExamRushModeValue(on) {
      examRushOn = on;
      if (examRushToggle) examRushToggle.checked = on;
      updateDots();
    }
    function dispose() {
      stopCountdown();
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = null;
      }
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
      themeChangeCallbacks.length = 0;
      root?.remove();
      root = null;
      badge = null;
      badgeDot = null;
      panel = null;
      headerDot = null;
      sessionLine = null;
      messageList = null;
      moduleSection = null;
      minimizeBtn = null;
      courseRushToggle = null;
      examRushToggle = null;
      gearBtn = null;
      settingsContainer = null;
      normalContent = null;
      titleSpanRef = null;
    }
    function subscribe() {
      unsubs.push(
        bus.on("token:acquired", (payload) => {
          const refreshRemaining = payload.refreshExpiresAt ? Math.max(0, payload.refreshExpiresAt - Date.now()) : 0;
          if (refreshRemaining > 0) {
            setSessionStatus("active", refreshRemaining);
          } else {
            setSessionStatus("active", 0);
          }
        })
      );
      unsubs.push(
        bus.on("token:expiring", (payload) => {
          setSessionStatus("expiring", payload.remainingMs);
        })
      );
      unsubs.push(
        bus.on("token:expired", () => {
          setSessionStatus("expired");
        })
      );
      unsubs.push(
        bus.on("page:changed", (payload) => {
          if (payload.path.includes("/login") || payload.path.includes("/subjects/registration")) {
            expand();
          }
          if (moduleSection) {
            while (moduleSection.firstChild) moduleSection.removeChild(moduleSection.firstChild);
          }
        })
      );
      unsubs.push(
        bus.on("module:error", (payload) => {
          const errMsg = payload.error instanceof Error ? payload.error.message : String(payload.error);
          addMessage("error", `[${payload.moduleId}] ${errMsg}`);
        })
      );
    }
    function autoExpandOnLoad() {
      const path = window.location.pathname;
      if (path.includes("/login") || path.includes("/subjects/registration")) {
        expand();
      }
    }
    build();
    subscribe();
    autoExpandOnLoad();
    return {
      setSessionStatus,
      addMessage,
      setModuleContent,
      setModuleContentElement,
      expand,
      collapse,
      toggle,
      isExpanded: isExpandedFn,
      getCourseRushMode,
      setCourseRushMode: setCourseRushModeValue,
      getExamRushMode,
      setExamRushMode: setExamRushModeValue,
      getThemeSettings: () => ({ ...themeSettings }),
      setThemeSettings: (settings) => {
        themeSettings = { ...settings };
      },
      onThemeSettingsChange: (cb) => {
        themeChangeCallbacks.push(cb);
        return () => {
          const idx = themeChangeCallbacks.indexOf(cb);
          if (idx >= 0) themeChangeCallbacks.splice(idx, 1);
        };
      },
      dispose
    };
  }
  const KNOWN_ENDPOINTS = {
    getNewTokens: "Account/GetNewTokens",
schedulableSubjects: "SubjectApplication/SchedulableSubjects"
  };
  const SESSION_STORAGE_KEYS = {
    accessToken: "access_token",
    refreshTokenExpiration: "refresh_token_expiration",
    loginType: "login_type",
    tabId: "tabId"
  };
  const REFRESH_BUFFER_S = 180;
  const POLL_INTERVAL_MS = 2e3;
  function decodeJwt(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = parts[1];
      const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  function setupInterceptor(bus, logger) {
    let lastToken = null;
    let pollTimer = null;
    let storageInaccessible = false;
    function readSessionStorage(key) {
      try {
        return sessionStorage.getItem(key);
      } catch (err) {
        if (err instanceof DOMException && err.name === "SecurityError") {
          if (!storageInaccessible) {
            storageInaccessible = true;
            logger.warn("sessionStorage is inaccessible (private browsing?), stopping poll:", err);
            if (pollTimer !== null) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          }
        } else {
          logger.warn("sessionStorage access failed (transient):", err);
        }
        return null;
      }
    }
    function checkToken() {
      if (storageInaccessible) return;
      const token = readSessionStorage(SESSION_STORAGE_KEYS.accessToken);
      if (!token) {
        if (lastToken !== null) {
          lastToken = null;
          logger.info("[interceptor-debug] checkToken: access token removed from sessionStorage (logout?)");
        }
        return;
      }
      if (token === lastToken) return;
      lastToken = token;
      const parts = token.split(".");
      logger.info(`[interceptor-debug] checkToken: new token detected, parts=${parts.length}`);
      const jwt = decodeJwt(token);
      if (!jwt) {
        logger.warn(`[interceptor-debug] checkToken: decode failed for token with ${parts.length} parts`);
        return;
      }
      logger.info(`[interceptor-debug] checkToken: decoded JWT, exp=${jwt.exp}`);
      const expiresAt = jwt.exp * 1e3;
      if (!Number.isFinite(expiresAt)) {
        logger.warn(`JWT exp claim is not a finite number (got ${jwt.exp}), skipping token`);
        return;
      }
      const refreshExpiration = readSessionStorage(
        SESSION_STORAGE_KEYS.refreshTokenExpiration
      );
      let refreshExpiresAt = 0;
      if (refreshExpiration) {
        const parsed = Date.parse(refreshExpiration);
        if (Number.isFinite(parsed)) {
          refreshExpiresAt = parsed;
        } else {
          logger.warn(`[interceptor-debug] refresh_token_expiration is not a valid date: "${refreshExpiration}"`);
        }
      }
      logger.info(
        `token detected, access expires at ${new Date(expiresAt).toISOString()}, refresh expires at ${refreshExpiresAt ? new Date(refreshExpiresAt).toISOString() : "unknown"}`
      );
      bus.emit("token:acquired", {
        accessToken: token,
        refreshToken: refreshExpiration ?? "",
        expiresAt,
        refreshExpiresAt
      });
    }
    checkToken();
    if (!storageInaccessible) {
      pollTimer = setInterval(checkToken, POLL_INTERVAL_MS);
      logger.info("sessionStorage token watcher started");
    }
    return () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      logger.info("sessionStorage token watcher stopped");
    };
  }
  function extractDomain(url) {
    const hostname = new URL(url).hostname;
    const parts = hostname.split(".");
    if (parts.length < 2) return hostname;
    const last2 = parts.slice(-2).join(".");
    if (parts.length >= 3) {
      const thirdFromEnd = parts[parts.length - 3];
      if (thirdFromEnd.startsWith("uni-")) {
        return parts.slice(-3).join(".");
      }
    }
    return last2;
  }
  const SUPPORTED_PORTAL_PREFIXES = [
    "/hallgatoi",
    "/hallgato_ng",
    "/hallgatoing",
    "/ujhallgato"
  ];
  function safeLower(value) {
    return (value ?? "").toLowerCase();
  }
  function isSupportedPortalPath(pathname) {
    const path = safeLower(pathname);
    return SUPPORTED_PORTAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }
  function hasNeptunFingerprint(doc = document) {
    const title = safeLower(doc.title);
    if (title.includes("neptun")) return true;
    const html = doc.documentElement;
    const htmlText = safeLower(html?.textContent?.slice(0, 2e3));
    if (htmlText.includes("neptun web") || htmlText.includes("neptun")) return true;
    const attributedNodes = Array.from(
      doc.querySelectorAll("script[src], link[href], img[src], meta[content]")
    );
    return attributedNodes.some((node) => {
      const values = [
        "src" in node ? node.getAttribute("src") : null,
        "href" in node ? node.getAttribute("href") : null,
        node.getAttribute("content")
      ];
      return values.some((value) => safeLower(value).includes("neptun"));
    });
  }
  function hasNeptunSessionStorage(storage = sessionStorage) {
    try {
      return [
        "access_token",
        "refresh_token_expiration",
        "login_type",
        "tabId"
      ].some((key) => storage.getItem(key) !== null);
    } catch {
      return false;
    }
  }
  function isLikelyNeptunPortal(locationLike = window.location, doc = document, storage = sessionStorage) {
    if (!isSupportedPortalPath(locationLike.pathname)) return false;
    return hasNeptunSessionStorage(storage) || hasNeptunFingerprint(doc);
  }
  function extractPath(url) {
    const parsed = new URL(url);
    return parsed.pathname;
  }
  function observeRouteChanges(bus) {
    let lastPath = window.location.pathname;
    function checkAndEmit() {
      const currentPath = window.location.pathname;
      if (currentPath !== lastPath) {
        lastPath = currentPath;
        bus.emit("page:changed", {
          url: window.location.href,
          path: currentPath
        });
      }
    }
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = function(...args) {
      originalPushState(...args);
      checkAndEmit();
    };
    history.replaceState = function(...args) {
      originalReplaceState(...args);
      checkAndEmit();
    };
    window.addEventListener("popstate", checkAndEmit);
    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", checkAndEmit);
    };
  }
  function getRefreshTokenRemaining() {
    try {
      const expStr = sessionStorage.getItem(SESSION_STORAGE_KEYS.refreshTokenExpiration);
      if (!expStr) return -1;
      const expMs = Date.parse(expStr);
      if (!Number.isFinite(expMs)) return -1;
      return expMs - Date.now();
    } catch {
      return -1;
    }
  }
  const REFRESH_BUFFER_MS = REFRESH_BUFFER_S * 1e3;
  const WATCHDOG_INTERVAL_MS = 15e3;
  let watchdogTimer = null;
  let fallbackRetryTimer = null;
  let keepAliveInFlight = false;
  let activeAbortController = null;
  let abortTimeoutId = null;
  let currentExpiresAt = 0;
  let api$2 = null;
  let unsubscribe = null;
  let visibilityHandler = null;
  let sessionModalObserver = null;
  function normalizeMatchText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function getExistingTokenPayload() {
    try {
      const accessToken = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken);
      if (!accessToken) return null;
      const jwt = decodeJwt(accessToken);
      if (!jwt) return null;
      const expiresAt = jwt.exp * 1e3;
      if (!Number.isFinite(expiresAt)) return null;
      const refreshExpiration = sessionStorage.getItem(SESSION_STORAGE_KEYS.refreshTokenExpiration);
      let refreshExpiresAt = 0;
      if (refreshExpiration) {
        const parsed = Date.parse(refreshExpiration);
        if (Number.isFinite(parsed)) {
          refreshExpiresAt = parsed;
        }
      }
      return {
        accessToken,
        refreshToken: refreshExpiration ?? "",
        expiresAt,
        refreshExpiresAt
      };
    } catch {
      return null;
    }
  }
  function getApiPathPrefix() {
    const pathSegments = window.location.pathname.split("/");
    return pathSegments.length >= 2 ? `/${pathSegments[1]}` : "";
  }
  function persistRefreshedTokens(bodyText) {
    if (!bodyText.trim()) return false;
    try {
      const data = JSON.parse(bodyText);
      const accessToken = data.access_token ?? data.accessToken;
      const refreshTokenExpiration = data.refresh_token_expiration ?? data.refreshTokenExpiration;
      if (!accessToken) return false;
      sessionStorage.setItem(SESSION_STORAGE_KEYS.accessToken, accessToken);
      if (refreshTokenExpiration) {
        sessionStorage.setItem(SESSION_STORAGE_KEYS.refreshTokenExpiration, refreshTokenExpiration);
      }
      const jwt = decodeJwt(accessToken);
      if (jwt) {
        currentExpiresAt = jwt.exp * 1e3;
      }
      return true;
    } catch (err) {
      api$2?.logger.warn("failed to parse refresh response JSON:", err);
      return false;
    }
  }
  function stopWatchdog() {
    if (watchdogTimer !== null) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    if (fallbackRetryTimer !== null) {
      clearTimeout(fallbackRetryTimer);
      fallbackRetryTimer = null;
    }
  }
  function startWatchdog() {
    if (watchdogTimer !== null) return;
    api$2?.logger.info("[session-debug] startWatchdog: starting 15s interval");
    watchdogTimer = setInterval(() => {
      if (!currentExpiresAt || !api$2) return;
      if (keepAliveInFlight) return;
      const remainingMs = currentExpiresAt - Date.now();
      api$2.logger.info(
        `[session-debug] watchdog tick: ${Math.round(remainingMs / 1e3)}s remaining, buffer=${REFRESH_BUFFER_S}s`
      );
      if (Date.now() >= currentExpiresAt - REFRESH_BUFFER_MS) {
        api$2.logger.info("[session-debug] watchdog tick: token is inside refresh buffer");
        triggerKeepAlive();
      } else {
        api$2.logger.info("[session-debug] watchdog tick: token still fresh, skipping refresh");
      }
    }, WATCHDOG_INTERVAL_MS);
  }
  function triggerKeepAlive() {
    if (!api$2) return;
    if (keepAliveInFlight) return;
    let accessToken;
    try {
      accessToken = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken);
    } catch {
      accessToken = null;
    }
    if (!accessToken) {
      api$2.logger.warn("[session-debug] cannot refresh session: no access token in sessionStorage");
      return;
    }
    keepAliveInFlight = true;
    const remainingMs = Math.max(0, currentExpiresAt - Date.now());
    api$2.statusPanel.setSessionStatus("refreshing");
    api$2.bus.emit("token:expiring", {
      expiresAt: currentExpiresAt,
      remainingMs
    });
    api$2.logger.info(
      `[session-debug] firing session refresh request with ${Math.round(remainingMs / 1e3)}s left on access token`
    );
    const refreshUrl = `${getApiPathPrefix()}/api/${KNOWN_ENDPOINTS.getNewTokens}`;
    activeAbortController = new AbortController();
    abortTimeoutId = setTimeout(() => activeAbortController?.abort(), 1e4);
    fetch(refreshUrl, {
      method: "POST",
      credentials: "include",
      body: "{}",
      signal: activeAbortController.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }).then(async (response) => {
      if (abortTimeoutId !== null) {
        clearTimeout(abortTimeoutId);
        abortTimeoutId = null;
      }
      activeAbortController = null;
      try {
        if (response.ok) {
          api$2?.logger.info("[session-debug] refresh request returned 200 OK");
          const bodyText = await response.text();
          const persisted = persistRefreshedTokens(bodyText);
          if (persisted) {
            api$2?.logger.info("session refresh succeeded");
          } else {
            api$2?.logger.warn("session refresh succeeded but returned no token payload");
          }
        } else if (response.status === 401 || response.status === 403) {
          api$2?.logger.warn(`[session-debug] refresh request returned auth error ${response.status}`);
          const refreshRemaining = getRefreshTokenRemaining();
          if (refreshRemaining > 0) {
            api$2?.logger.warn(
              `refresh endpoint was rejected while refresh token still looks valid (${Math.round(refreshRemaining / 1e3)}s left)`
            );
          } else {
            api$2?.logger.warn("session refresh was rejected and refresh token expired, session lost");
            api$2?.bus.emit("token:expired", {});
          }
        } else {
          api$2?.logger.warn(
            `[session-debug] refresh request returned unexpected status ${response.status}`
          );
          api$2?.logger.warn(`session refresh returned unexpected status: ${response.status}`);
        }
      } finally {
        keepAliveInFlight = false;
      }
    }).catch((err) => {
      if (abortTimeoutId !== null) {
        clearTimeout(abortTimeoutId);
        abortTimeoutId = null;
      }
      activeAbortController = null;
      keepAliveInFlight = false;
      if (!api$2) return;
      api$2.logger.warn("session refresh request failed:", err);
      if (Date.now() >= currentExpiresAt) {
        api$2.logger.warn("token has expired and session refresh failed, session lost");
        api$2.bus.emit("token:expired", {});
      } else {
        const remaining = currentExpiresAt - Date.now();
        if (remaining > 15e3) {
          api$2.logger.info("token still valid, scheduling 10s fallback retry");
          api$2.statusPanel.setSessionStatus("refreshing");
          if (fallbackRetryTimer !== null) clearTimeout(fallbackRetryTimer);
          fallbackRetryTimer = setTimeout(() => {
            fallbackRetryTimer = null;
            triggerKeepAlive();
          }, 1e4);
        } else {
          api$2.logger.info(
            `token has only ${Math.round(remaining / 1e3)}s left, watchdog will handle`
          );
        }
      }
    });
  }
  function onTokenAcquired(payload) {
    if (!Number.isFinite(payload.expiresAt)) {
      api$2?.logger.warn(`token:acquired expiresAt is not finite (${payload.expiresAt}), ignoring`);
      return;
    }
    currentExpiresAt = payload.expiresAt;
    api$2?.logger.info(
      `[session-debug] token acquired: access expires in ${Math.round((payload.expiresAt - Date.now()) / 1e3)}s, refresh expires in ${payload.refreshExpiresAt ? Math.round((payload.refreshExpiresAt - Date.now()) / 1e3) : "unknown"}s`
    );
    if (fallbackRetryTimer !== null) {
      clearTimeout(fallbackRetryTimer);
      fallbackRetryTimer = null;
      api$2?.logger.info("[session-debug] cleared pending fallback retry after token update");
    }
    startWatchdog();
  }
  function hydrateFromSessionStorage() {
    const payload = getExistingTokenPayload();
    if (!payload) {
      api$2?.logger.info("[session-debug] initialize: no existing token found in sessionStorage");
      return;
    }
    api$2?.logger.info(
      `[session-debug] initialize: recovered existing token with ${Math.round((payload.expiresAt - Date.now()) / 1e3)}s remaining`
    );
    onTokenAcquired(payload);
  }
  function onVisibilityChange() {
    try {
      api$2?.logger.info(`[session-debug] onVisibilityChange: state="${document.visibilityState}"`);
      if (document.visibilityState !== "visible") return;
      if (!currentExpiresAt || !api$2) return;
      if (keepAliveInFlight) return;
      const remaining = currentExpiresAt - Date.now();
      api$2.logger.info(
        `[session-debug] onVisibilityChange: tab visible, remaining=${Math.round(remaining / 1e3)}s, buffer=${REFRESH_BUFFER_S}s`
      );
      if (remaining <= REFRESH_BUFFER_MS) {
        api$2.logger.info(
          "[session-debug] onVisibilityChange: token near expiry, triggering keep-alive immediately"
        );
        triggerKeepAlive();
      }
    } catch (err) {
      api$2?.logger.error("error in visibility change handler:", err);
    }
  }
  function suppressSessionTimeoutModals() {
    sessionModalObserver?.disconnect();
    sessionModalObserver = new MutationObserver(() => {
      const overlayButtons = document.querySelectorAll(
        ".cdk-overlay-container button, .mat-mdc-dialog-container button"
      );
      for (const btn of Array.from(overlayButtons)) {
        const rawText = (btn.textContent ?? "").trim();
        const text = normalizeMatchText(rawText);
        const dialogText = normalizeMatchText(
          btn.closest(".cdk-overlay-pane, .mat-mdc-dialog-container")?.textContent ?? ""
        );
        const isSessionDialog = (dialogText.includes("session") || dialogText.includes("munkamenet")) && (dialogText.includes("lejar") || dialogText.includes("expir") || dialogText.includes("timeout") || dialogText.includes("idotullepes") || dialogText.includes("kijelentkezes") || /\d+\s*(perc|sec|mp|masodperc)/.test(dialogText));
        const isExtendButton = text === "ok" || text === "igen" || text.includes("extend") || text.includes("meghosszabbit") || text.includes("folytat") || text.includes("marad");
        if (isSessionDialog && isExtendButton) {
          api$2?.logger.info(`[session-debug] suppressing session timeout modal, clicking: ${rawText}`);
          api$2?.statusPanel.addMessage("info", "Session timeout dialog dismissed");
          btn.click();
          return;
        }
      }
    });
    sessionModalObserver.observe(document.body, { childList: true, subtree: true });
  }
  const infiniteSessionModule = {
    id: "infinite-session",
    name: "Infinite Session",
    description: "Keeps the current Neptun session alive when possible",
    shouldActivate(_context) {
      return true;
    },
    initialize(moduleApi) {
      api$2 = moduleApi;
      unsubscribe = api$2.bus.on("token:acquired", onTokenAcquired);
      visibilityHandler = onVisibilityChange;
      document.addEventListener("visibilitychange", visibilityHandler);
      suppressSessionTimeoutModals();
      hydrateFromSessionStorage();
      api$2.logger.info("initialized, waiting for token from sessionStorage watcher");
    },
    dispose() {
      stopWatchdog();
      activeAbortController?.abort();
      activeAbortController = null;
      if (abortTimeoutId !== null) {
        clearTimeout(abortTimeoutId);
        abortTimeoutId = null;
      }
      keepAliveInFlight = false;
      unsubscribe?.();
      unsubscribe = null;
      sessionModalObserver?.disconnect();
      sessionModalObserver = null;
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      currentExpiresAt = 0;
      api$2 = null;
    }
  };
  const WAIT_TIMEOUT_MS = 5e3;
  const STORAGE_KEY$1 = "courseSelections";
  let api$1 = null;
  let isEnrolling = false;
  let routeUnsub = null;
  function getApi$1() {
    return api$1;
  }
  function setApi$1(value) {
    api$1 = value;
  }
  function getIsEnrolling() {
    return isEnrolling;
  }
  function setIsEnrolling(value) {
    isEnrolling = value;
  }
  function getRouteUnsub() {
    return routeUnsub;
  }
  function setRouteUnsub(value) {
    routeUnsub = value;
  }
  async function loadSelections() {
    const api2 = getApi$1();
    if (!api2) return {};
    const data = await api2.storage.getForDomain(STORAGE_KEY$1);
    return data ?? {};
  }
  async function saveSelections(selections) {
    const api2 = getApi$1();
    if (!api2) return;
    await api2.storage.setForDomain(STORAGE_KEY$1, selections);
  }
  async function clearSelections() {
    const api2 = getApi$1();
    if (!api2) return;
    await api2.storage.setForDomain(STORAGE_KEY$1, {});
  }
  async function removeSingleSubject(subjectCode) {
    const api2 = getApi$1();
    if (!api2) return;
    const existing = await loadSelections();
    delete existing[subjectCode];
    await saveSelections(existing);
    api2.logger.info(`removed saved courses for ${subjectCode}`);
    api2.statusPanel.addMessage("info", `Removed saved courses for ${subjectCode}.`);
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function waitForRequestComplete(urlPattern, timeoutMs, startedAfterMs = performance.now()) {
    return new Promise((resolve) => {
      let settled = false;
      function matches(entry) {
        if (!entry.name.includes(urlPattern)) return false;
        return typeof entry.startTime !== "number" || entry.startTime >= startedAfterMs;
      }
      function settle(result) {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(result);
      }
      function settleFromEntry(entry) {
        const resourceEntry = entry;
        const status = typeof resourceEntry.responseStatus === "number" ? resourceEntry.responseStatus : null;
        settle({
          completed: true,
          status
        });
      }
      const existingEntries = performance.getEntriesByType("resource");
      const existingMatch = existingEntries.find(matches);
      if (existingMatch) {
        settleFromEntry(existingMatch);
        return;
      }
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (matches(entry)) {
            settleFromEntry(entry);
            return;
          }
        }
      });
      try {
        observer.observe({ type: "resource", buffered: true });
      } catch {
        observer.observe({ type: "resource", buffered: false });
      }
      setTimeout(() => settle({ completed: false, status: null }), timeoutMs);
    });
  }
  const SUBJECT_CODE_CANDIDATE_RE = /\b[A-Z0-9][A-Z0-9-]{5,24}\b/g;
  function countMatches(value, pattern) {
    return value.match(pattern)?.length ?? 0;
  }
  function normalizeSubjectCode(value) {
    return value.replace(/\s+/g, "").trim().toUpperCase();
  }
  function isLikelySubjectCode(value) {
    const normalized = normalizeSubjectCode(value);
    if (normalized.length < 6 || normalized.length > 25) return false;
    if (normalized.includes("_") || normalized.includes(".")) return false;
    if (!/[A-Z]/.test(normalized) || !/\d/.test(normalized)) return false;
    const letterCount = countMatches(normalized, /[A-Z]/g);
    const digitCount = countMatches(normalized, /\d/g);
    return letterCount >= 2 && digitCount >= 2;
  }
  function extractSubjectCodeFromText(text) {
    const normalizedText = text.replace(/\s+/g, " ").trim().toUpperCase();
    if (!normalizedText) return null;
    let bestCandidate = null;
    let bestScore = -1;
    for (const match of normalizedText.matchAll(SUBJECT_CODE_CANDIDATE_RE)) {
      const candidate = normalizeSubjectCode(match[0]);
      if (!isLikelySubjectCode(candidate)) continue;
      const position = match.index ?? 0;
      const relativePosition = normalizedText.length > 0 ? position / normalizedText.length : 0;
      const score = candidate.length * 10 + (candidate.includes("-") ? 15 : 0) + Math.round(relativePosition * 10);
      if (score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }
    return bestCandidate;
  }
  function waitForElement(selector, root = document, timeoutMs = WAIT_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const existing = root.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      let settled = false;
      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el && !settled) {
          settled = true;
          observer.disconnect();
          resolve(el);
        }
      });
      function settle(result) {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(result);
      }
      try {
        observer.observe(root instanceof Document ? root.body : root, {
          childList: true,
          subtree: true
        });
      } catch {
        settle(null);
        return;
      }
      setTimeout(() => settle(null), timeoutMs);
    });
  }
  const AUTO_SEARCH_TIMEOUT_MS = 2e4;
  const AUTO_SEARCH_POLL_MS = 250;
  const AUTO_SEARCH_STABLE_MS = 500;
  const SEARCH_RESULT_SETTLE_GRACE_MS = 2e3;
  function normalizeButtonText(text) {
    return text.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  const SEARCH_BUTTON_PATTERNS = [
    "targy keres",
    "search subject",
    "subject search"
  ];
  const ENROLL_BUTTON_PATTERNS = [
    "targy felvetele",
    "take subject",
    "enroll subject"
  ];
  function sanitizeText(text, maxLen = 60) {
    return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
  }
  function normalizeCourseCode(code) {
    return code.replace(/\s+/g, "").trim().toUpperCase();
  }
  const COURSE_CODE_STOP_WORDS = [
    "ELOADAS",
    "GYAKORLAT",
    "JELENLETI",
    "KREDIT",
    "KURZUS",
    "LABOR",
    "LIMIT",
    "MINIMALIS",
    "TIPUS"
  ];
  function isCourseCodeToken(token, { allowShortAlpha = false } = {}) {
    const normalized = normalizeCourseCode(token);
    const minLength = allowShortAlpha ? 1 : 2;
    if (normalized.length < minLength || normalized.length > 20) return false;
    if (isLikelySubjectCode(normalized)) return false;
    if (!/^[A-Z0-9][A-Z0-9_.-]*$/.test(normalized)) return false;
    if (COURSE_CODE_STOP_WORDS.some((word) => normalized.startsWith(word))) {
      return false;
    }
    if (allowShortAlpha && /^[A-Z]{1,4}$/.test(normalized)) {
      return true;
    }
    return /[A-Z]/.test(normalized) && /[0-9_]/.test(normalized);
  }
  function extractCourseCodeFromText(text) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    const exact = normalizeCourseCode(trimmed);
    if (isCourseCodeToken(exact)) return exact;
    const underscored = /[A-Z0-9]{1,10}_[A-Z0-9]{1,10}/i.exec(trimmed);
    if (underscored && isCourseCodeToken(underscored[0])) {
      return normalizeCourseCode(underscored[0]);
    }
    const boundedTokens = trimmed.match(/\b[A-Z0-9][A-Z0-9_.-]{1,19}\b/gi) ?? [];
    for (const token of boundedTokens) {
      if (isCourseCodeToken(token)) return normalizeCourseCode(token);
    }
    return null;
  }
  function extractCourseCodeFromExactCandidate(text) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    const exact = normalizeCourseCode(trimmed);
    if (isCourseCodeToken(exact, { allowShortAlpha: true })) {
      return exact;
    }
    return null;
  }
  function getTextNodeCandidates(root) {
    const candidates = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (parent?.closest("button, mat-icon, .mat-icon, mat-chip, .mat-chip, .mat-mdc-chip")) {
        continue;
      }
      candidates.push(text);
    }
    return candidates;
  }
  function isSearchButtonText(text) {
    const normalized = normalizeButtonText(text);
    return SEARCH_BUTTON_PATTERNS.some((pattern) => normalized.includes(pattern));
  }
  function isEnrollButtonText(text) {
    const normalized = normalizeButtonText(text);
    return ENROLL_BUTTON_PATTERNS.some((pattern) => normalized.includes(pattern));
  }
  function findSearchButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const match = buttons.find((btn) => isSearchButtonText(btn.textContent ?? ""));
    return match ?? null;
  }
  function isButtonInteractable(button) {
    if (!button.isConnected) return false;
    if (button.hasAttribute("disabled")) return false;
    const htmlButton = button;
    if (typeof htmlButton.disabled === "boolean" && htmlButton.disabled) return false;
    const ariaDisabled = button.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return false;
    const style = window.getComputedStyle(button);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
      return false;
    }
    return true;
  }
  function describeButton(button) {
    if (!button) return null;
    return {
      text: sanitizeText(button.textContent ?? ""),
      disabled: button.hasAttribute("disabled") || button.disabled,
      ariaDisabled: button.getAttribute("aria-disabled"),
      connected: button.isConnected,
      className: button.className
    };
  }
  function getAutoSearchSnapshot() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const buttonTexts = buttons.map((btn) => sanitizeText(btn.textContent ?? "")).filter((text) => text.length > 0);
    return {
      readyState: document.readyState,
      path: window.location.pathname,
      panels: getSubjectPanels().length,
      buttons: buttons.length,
      searchCandidates: buttonTexts.filter((text) => isSearchButtonText(text)),
      sampleButtons: buttonTexts.slice(0, 8)
    };
  }
  function describeRequestResult(result) {
    if (!result) {
      return {
        completed: false,
        status: null
      };
    }
    return {
      completed: result.completed,
      status: result.status
    };
  }
  function extractSubjectCode(panel) {
    const api2 = getApi$1();
    const headerText = panel.querySelector("mat-expansion-panel-header")?.textContent ?? panel.querySelector(".mat-expansion-panel-header")?.textContent ?? panel.textContent ?? "";
    const code = extractSubjectCodeFromText(headerText);
    if (!code) {
      api2?.logger.info(`[dom-debug] extractSubjectCode: no code found, header starts with "${headerText.substring(0, 50)}"`);
    }
    return code;
  }
  function extractCourseCode(courseItem) {
    const api2 = getApi$1();
    const text = (courseItem.textContent ?? "").trim();
    const selectors = [
      ".mat-mdc-checkbox .mdc-label",
      ".mat-checkbox-label",
      "mat-checkbox label",
      ".mat-mdc-checkbox label",
      "[data-course-code]",
      "[aria-label]",
      "[title]"
    ];
    for (const selector of selectors) {
      const elements = Array.from(courseItem.querySelectorAll(selector));
      for (const element of elements) {
        const values = [
          element.textContent ?? "",
          element.getAttribute("data-course-code") ?? "",
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("title") ?? ""
        ];
        for (const value of values) {
          const code = extractCourseCodeFromExactCandidate(value) ?? extractCourseCodeFromText(value);
          if (code) {
            api2?.logger.info(`[dom-debug] extractCourseCode: selector "${selector}" matched="${code}"`);
            return code;
          }
        }
      }
    }
    for (const candidate of getTextNodeCandidates(courseItem)) {
      const code = extractCourseCodeFromExactCandidate(candidate) ?? extractCourseCodeFromText(candidate);
      if (code) {
        api2?.logger.info(`[dom-debug] extractCourseCode: text node matched="${code}"`);
        return code;
      }
    }
    const beforeType = /(?:^|[\s:])([A-Z0-9][A-Z0-9_.-]{1,19})(?=\s*T(?:i|í)pus)/i.exec(text);
    if (beforeType && isCourseCodeToken(beforeType[1])) {
      const code = normalizeCourseCode(beforeType[1]);
      api2?.logger.info(`[dom-debug] extractCourseCode: before type label matched="${code}"`);
      return code;
    }
    const afterCourseCodeLabel = /Kurzus\s*k(?:o|ó)d\s*:?\s*([A-Z0-9][A-Z0-9_.-]{1,19})/i.exec(text);
    if (afterCourseCodeLabel && isCourseCodeToken(afterCourseCodeLabel[1])) {
      const code = normalizeCourseCode(afterCourseCodeLabel[1]);
      api2?.logger.info(`[dom-debug] extractCourseCode: after course-code label matched="${code}"`);
      return code;
    }
    api2?.logger.warn(`[dom-debug] extractCourseCode: no course code found, text starts with "${text.substring(0, 50)}"`);
    return null;
  }
  function getSubjectPanels() {
    return Array.from(document.querySelectorAll("mat-expansion-panel"));
  }
  function findSubjectPanel(subjectCode) {
    return getSubjectPanels().find((panel) => extractSubjectCode(panel) === subjectCode) ?? null;
  }
  async function autoSearchSubjects() {
    const api2 = getApi$1();
    const start = Date.now();
    const existingPanels = getSubjectPanels().length;
    api2?.logger.info("[dom-debug] autoSearchSubjects: starting", {
      ...getAutoSearchSnapshot(),
      timeoutMs: AUTO_SEARCH_TIMEOUT_MS
    });
    if (existingPanels > 0) {
      api2?.logger.info(`[dom-debug] autoSearchSubjects: skipping, ${existingPanels} subjects already listed`);
      return {
        clickedSearchButton: false,
        searchStartedAtMs: null
      };
    }
    api2?.logger.info("[dom-debug] autoSearchSubjects: no subjects listed, waiting for search button...");
    const observerTarget = document.body ?? document.documentElement;
    let mutationCount = 0;
    let lastMutationAt = Date.now();
    let lastButtonCount = document.querySelectorAll("button").length;
    let lastPanelCount = existingPanels;
    let lastCandidateState = "";
    const observer = observerTarget ? new MutationObserver((mutations) => {
      mutationCount += mutations.length;
      lastMutationAt = Date.now();
      const buttonCount = document.querySelectorAll("button").length;
      const panelCount = getSubjectPanels().length;
      if (buttonCount !== lastButtonCount || panelCount !== lastPanelCount) {
        lastButtonCount = buttonCount;
        lastPanelCount = panelCount;
        api2?.logger.info("[dom-debug] autoSearchSubjects: DOM changed while waiting", {
          elapsedMs: Date.now() - start,
          readyState: document.readyState,
          panels: panelCount,
          buttons: buttonCount
        });
      }
    }) : null;
    try {
      observer?.observe(observerTarget, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch (err) {
      api2?.logger.warn("[dom-debug] autoSearchSubjects: failed to observe DOM changes", err);
    }
    while (Date.now() - start < AUTO_SEARCH_TIMEOUT_MS) {
      const panels = getSubjectPanels().length;
      if (panels > 0) {
        observer?.disconnect();
        api2?.logger.info("[dom-debug] autoSearchSubjects: subjects appeared before auto-click was needed", {
          elapsedMs: Date.now() - start,
          panels,
          mutations: mutationCount
        });
        return {
          clickedSearchButton: false,
          searchStartedAtMs: null
        };
      }
      const searchBtn = findSearchButton();
      if (searchBtn) {
        const interactable = isButtonInteractable(searchBtn);
        const candidateState = JSON.stringify({
          ...describeButton(searchBtn),
          interactable
        });
        if (candidateState !== lastCandidateState) {
          lastCandidateState = candidateState;
          api2?.logger.info("[dom-debug] autoSearchSubjects: found search button candidate", {
            elapsedMs: Date.now() - start,
            ...describeButton(searchBtn),
            interactable
          });
        }
        if (interactable) {
          const idleMs = Date.now() - lastMutationAt;
          if (idleMs >= AUTO_SEARCH_STABLE_MS) {
            const searchStartedAtMs = performance.now();
            searchBtn.click();
            observer?.disconnect();
            api2?.logger.info("[dom-debug] autoSearchSubjects: auto-clicked search button", {
              elapsedMs: Date.now() - start,
              idleMs,
              mutations: mutationCount,
              button: describeButton(searchBtn)
            });
            return {
              clickedSearchButton: true,
              searchStartedAtMs
            };
          }
        }
      }
      await delay(AUTO_SEARCH_POLL_MS);
    }
    observer?.disconnect();
    api2?.logger.warn(`[dom-debug] autoSearchSubjects: search button not found within ${AUTO_SEARCH_TIMEOUT_MS}ms`, {
      elapsedMs: Date.now() - start,
      mutations: mutationCount,
      snapshot: getAutoSearchSnapshot()
    });
    return {
      clickedSearchButton: false,
      searchStartedAtMs: null
    };
  }
  async function waitForSubjectListing({
    timeoutMs = 6e4,
    searchStartedAtMs = performance.now(),
    allowAutoClick = false
  } = {}) {
    const api2 = getApi$1();
    const start = Date.now();
    const initialPanels = getSubjectPanels().length;
    if (initialPanels > 0) {
      api2?.logger.info("[dom-debug] waitForSubjectListing: subjects already listed", {
        panels: initialPanels
      });
      return {
        state: "panels-loaded",
        panels: initialPanels,
        requestStatus: null
      };
    }
    api2?.logger.info("[dom-debug] waitForSubjectListing: waiting for subject search result", {
      timeoutMs,
      searchStartedAtMs,
      allowAutoClick,
      snapshot: getAutoSearchSnapshot()
    });
    const requestPromise = waitForRequestComplete(
      KNOWN_ENDPOINTS.schedulableSubjects,
      timeoutMs,
      searchStartedAtMs
    );
    const requestTracker = {
      current: null,
      completedAtMs: null
    };
    requestPromise.then((result) => {
      requestTracker.current = result;
      requestTracker.completedAtMs = Date.now();
    }).catch((err) => {
      api2?.logger.warn("[dom-debug] waitForSubjectListing: request observer failed", err);
    });
    const observerTarget = document.body ?? document.documentElement;
    let mutationCount = 0;
    let lastMutationAt = Date.now();
    let lastPanelCount = initialPanels;
    let lastCandidateState = "";
    let delayedAutoClickTriggered = false;
    const observer = observerTarget ? new MutationObserver((mutations) => {
      mutationCount += mutations.length;
      lastMutationAt = Date.now();
      const panelCount = getSubjectPanels().length;
      if (panelCount !== lastPanelCount) {
        lastPanelCount = panelCount;
        api2?.logger.info("[dom-debug] waitForSubjectListing: panel count changed", {
          elapsedMs: Date.now() - start,
          panels: panelCount
        });
      }
    }) : null;
    try {
      observer?.observe(observerTarget, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch (err) {
      api2?.logger.warn("[dom-debug] waitForSubjectListing: failed to observe DOM changes", err);
    }
    while (Date.now() - start < timeoutMs) {
      const panels = getSubjectPanels().length;
      if (panels > 0) {
        observer?.disconnect();
        const requestStatus2 = requestTracker.current ? requestTracker.current.status : null;
        api2?.logger.info("[dom-debug] waitForSubjectListing: subjects loaded", {
          elapsedMs: Date.now() - start,
          panels,
          mutations: mutationCount,
          request: describeRequestResult(requestTracker.current)
        });
        return {
          state: "panels-loaded",
          panels,
          requestStatus: requestStatus2
        };
      }
      const idleMs = Date.now() - lastMutationAt;
      const searchBtn = findSearchButton();
      if (searchBtn) {
        const interactable = isButtonInteractable(searchBtn);
        const candidateState = JSON.stringify({
          ...describeButton(searchBtn),
          interactable
        });
        if (candidateState !== lastCandidateState) {
          lastCandidateState = candidateState;
          api2?.logger.info("[dom-debug] waitForSubjectListing: observed search button candidate", {
            elapsedMs: Date.now() - start,
            ...describeButton(searchBtn),
            interactable
          });
        }
        if (allowAutoClick && !delayedAutoClickTriggered && interactable && idleMs >= AUTO_SEARCH_STABLE_MS) {
          delayedAutoClickTriggered = true;
          searchBtn.click();
          api2?.logger.info("[dom-debug] waitForSubjectListing: auto-clicked delayed search button", {
            elapsedMs: Date.now() - start,
            idleMs,
            mutations: mutationCount,
            button: describeButton(searchBtn)
          });
          await delay(AUTO_SEARCH_POLL_MS);
          continue;
        }
      }
      const settledRequest = requestTracker.current;
      const requestSettledForMs = requestTracker.completedAtMs === null ? 0 : Date.now() - requestTracker.completedAtMs;
      if (settledRequest !== null && settledRequest.completed) {
        if (settledRequest.status !== null && settledRequest.status >= 400 && idleMs >= AUTO_SEARCH_STABLE_MS && requestSettledForMs >= SEARCH_RESULT_SETTLE_GRACE_MS) {
          observer?.disconnect();
          api2?.logger.warn("[dom-debug] waitForSubjectListing: subject search request failed", {
            elapsedMs: Date.now() - start,
            idleMs,
            requestSettledForMs,
            mutations: mutationCount,
            status: settledRequest.status
          });
          return {
            state: "request-failed",
            panels: 0,
            requestStatus: settledRequest.status
          };
        }
        const interactable = searchBtn ? isButtonInteractable(searchBtn) : false;
        if (idleMs >= AUTO_SEARCH_STABLE_MS && requestSettledForMs >= SEARCH_RESULT_SETTLE_GRACE_MS && (interactable || searchBtn === null)) {
          observer?.disconnect();
          api2?.logger.info("[dom-debug] waitForSubjectListing: search settled without subject panels", {
            elapsedMs: Date.now() - start,
            idleMs,
            requestSettledForMs,
            mutations: mutationCount,
            request: describeRequestResult(requestTracker.current),
            button: describeButton(searchBtn)
          });
          return {
            state: "request-completed-no-panels",
            panels: 0,
            requestStatus: settledRequest.status
          };
        }
      }
      await delay(AUTO_SEARCH_POLL_MS);
    }
    observer?.disconnect();
    api2?.logger.warn("[dom-debug] waitForSubjectListing: timed out waiting for subject listing", {
      elapsedMs: Date.now() - start,
      mutations: mutationCount,
      request: describeRequestResult(requestTracker.current),
      snapshot: getAutoSearchSnapshot()
    });
    const requestStatus = requestTracker.current ? requestTracker.current.status : null;
    return {
      state: "timed-out",
      panels: getSubjectPanels().length,
      requestStatus
    };
  }
  function isPanelExpanded(panel) {
    if (panel.classList.contains("mat-expanded")) return true;
    if (panel.getAttribute("ng-reflect-expanded") === "true") return true;
    if (panel.querySelectorAll(".course-list-item-container").length > 0) return true;
    if (panel.querySelector('.mat-expansion-panel-content[style*="visibility: visible"]') !== null) return true;
    const header = panel.querySelector("mat-expansion-panel-header");
    if (header?.getAttribute("aria-expanded") === "true") return true;
    return false;
  }
  async function expandPanel(panel) {
    const api2 = getApi$1();
    if (isPanelExpanded(panel)) {
      api2?.logger.info("[dom-debug] expandPanel: panel already expanded");
      return true;
    }
    const header = panel.querySelector("mat-expansion-panel-header");
    if (!header) {
      api2?.logger.warn("[dom-debug] expandPanel: mat-expansion-panel-header not found");
      return false;
    }
    header.click();
    api2?.logger.info("[dom-debug] expandPanel: clicked header, waiting for course items...");
    const body = await waitForElement(".course-list-item-container", panel);
    if (!body) {
      api2?.logger.warn("[dom-debug] expandPanel: waitForElement timed out, using fallback delay");
      await delay(800);
    }
    const result = isPanelExpanded(panel);
    api2?.logger.info(`[dom-debug] expandPanel: completed, expanded=${result}`);
    return result;
  }
  function getCourseItems(panel) {
    return Array.from(panel.querySelectorAll(".course-list-item-container"));
  }
  function isCourseSelected(courseItem) {
    if (courseItem.classList.contains("course-list-item-container--selected")) {
      return true;
    }
    const checkbox = courseItem.querySelector('input[type="checkbox"]');
    if (!checkbox) return false;
    if (checkbox.checked) return true;
    if (checkbox.getAttribute("aria-checked") === "true") return true;
    return false;
  }
  async function toggleCourse(courseItem) {
    const api2 = getApi$1();
    const wasBefore = isCourseSelected(courseItem);
    const label = courseItem.querySelector("mat-checkbox label, .mat-mdc-checkbox label");
    if (label) {
      api2?.logger.info("[dom-debug] toggleCourse: clicking label target");
      label.click();
    } else {
      const touchTarget = courseItem.querySelector(".mat-mdc-checkbox-touch-target");
      if (touchTarget) {
        api2?.logger.info("[dom-debug] toggleCourse: clicking touchTarget fallback");
        touchTarget.click();
      } else {
        const checkbox = courseItem.querySelector("mat-checkbox") ?? courseItem.querySelector(".mat-mdc-checkbox") ?? courseItem.querySelector('input[type="checkbox"]');
        if (checkbox) {
          api2?.logger.info("[dom-debug] toggleCourse: clicking checkbox fallback");
          checkbox.click();
        } else {
          api2?.logger.warn("[dom-debug] toggleCourse: no click target found");
        }
      }
    }
    await delay(100);
    const isAfter = isCourseSelected(courseItem);
    if (wasBefore === isAfter) {
      api2?.logger.warn("toggleCourse: --selected class did not change after click");
    }
  }
  async function loadStoredSelections() {
    const api2 = getApi$1();
    const selections = await loadSelections();
    const subjectCodes = Object.keys(selections);
    if (subjectCodes.length === 0) {
      api2?.logger.info("no stored selections to load");
      api2?.statusPanel.addMessage("info", "No saved course selections found.");
      return;
    }
    api2?.logger.info(`loading selections for ${subjectCodes.length} subjects`);
    api2?.statusPanel.addMessage(
      "info",
      `Loading ${subjectCodes.length} saved subject${subjectCodes.length === 1 ? "" : "s"}...`
    );
    api2?.logger.info(
      `[load-debug] loadStoredSelections: preparing to match ${subjectCodes.length} stored subjects on the live page`
    );
    let loadedCount = 0;
    for (const subjectCode of subjectCodes) {
      const courseCodes = selections[subjectCode];
      const panel = findSubjectPanel(subjectCode);
      if (!panel) {
        api2?.logger.warn(
          `[load-debug] loadStoredSelections: subject ${subjectCode} not found on the live page - skipping`
        );
        continue;
      }
      api2?.logger.info(`[load-debug] loadStoredSelections: expanding panel for ${subjectCode}...`);
      const expanded = await expandPanel(panel);
      if (!expanded) {
        api2?.logger.warn(`[load-debug] loadStoredSelections: expansion failed for ${subjectCode}`);
        continue;
      }
      api2?.logger.info(`[load-debug] loadStoredSelections: panel expanded for ${subjectCode}`);
      let matchedCourses = 0;
      for (const courseCode of courseCodes) {
        const livePanel = findSubjectPanel(subjectCode);
        if (!livePanel) {
          api2?.logger.warn(
            `[load-debug] loadStoredSelections: subject ${subjectCode} disappeared after expansion`
          );
          break;
        }
        const items = getCourseItems(livePanel);
        api2?.logger.info(
          `[load-debug] loadStoredSelections: ${items.length} live course items in ${subjectCode}, matching ${courseCode}`
        );
        const item = items.find((candidate) => extractCourseCode(candidate) === courseCode);
        if (!item) {
          api2?.logger.warn(
            `[load-debug] loadStoredSelections: course ${courseCode} not found in ${subjectCode}`
          );
          continue;
        }
        if (!isCourseSelected(item)) {
          await toggleCourse(item);
          api2?.logger.info(
            `[load-debug] loadStoredSelections: toggled course ${courseCode} in ${subjectCode}`
          );
        } else {
          api2?.logger.info(
            `[load-debug] loadStoredSelections: course ${courseCode} already selected in ${subjectCode}`
          );
        }
        matchedCourses++;
      }
      api2?.logger.info(
        `[load-debug] loadStoredSelections: matched ${matchedCourses}/${courseCodes.length} courses for ${subjectCode}`
      );
      if (matchedCourses > 0) loadedCount++;
      const verificationPanel = findSubjectPanel(subjectCode);
      const actualSelected = verificationPanel ? getCourseItems(verificationPanel).filter((item) => isCourseSelected(item)).length : 0;
      if (verificationPanel && actualSelected !== courseCodes.length) {
        const mismatchMsg = `${subjectCode}: ${actualSelected} selected in DOM vs ${courseCodes.length} requested`;
        api2?.logger.warn(`[load-debug] loadStoredSelections: selection mismatch - ${mismatchMsg}`);
        api2?.statusPanel.addMessage("warn", `Selection mismatch: ${mismatchMsg}`);
      }
    }
    api2?.logger.info(`loaded selections for ${loadedCount} / ${subjectCodes.length} subjects`);
    api2?.statusPanel.addMessage(
      "info",
      `Loaded ${loadedCount}/${subjectCodes.length}. Review, then use Enroll Selected or enroll manually.`
    );
  }
  async function ensureTokenFresh() {
    const api2 = getApi$1();
    try {
      const token = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken);
      if (!token) return;
      const parts = token.split(".");
      if (parts.length !== 3) return;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      const expiresAt = payload.exp * 1e3;
      const remaining = expiresAt - Date.now();
      api2?.logger.info(`[enroll-debug] ensureTokenFresh: remaining=${Math.round(remaining / 1e3)}s`);
      if (remaining < 3e4) {
        api2?.logger.info(
          "[enroll-debug] ensureTokenFresh: token expiring soon, triggering refresh..."
        );
        const pathPrefix = window.location.pathname.split("/")[1] || "hallgatoi";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5e3);
        try {
          await fetch(`/${pathPrefix}/api/Message/GetUnreadedMessagesCount`, {
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
        await delay(2e3);
        api2?.logger.info("[enroll-debug] ensureTokenFresh: refresh triggered, continuing");
      }
    } catch {
    }
  }
  async function quickEnrollAll() {
    const api2 = getApi$1();
    if (getIsEnrolling()) {
      api2?.logger.warn("enrollment already in progress");
      return;
    }
    setIsEnrolling(true);
    try {
      try {
        const token = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken);
        if (!token) {
          api2?.logger.warn("no access_token in sessionStorage - session may have expired");
          api2?.statusPanel.addMessage("error", "Session expired. Log in again before enrolling.");
          return;
        }
      } catch (err) {
        api2?.logger.warn("cannot check sessionStorage for access_token:", err);
      }
      const panels = getSubjectPanels();
      const enrollable = panels.filter((panel) => {
        if (!isPanelExpanded(panel)) return false;
        const items = getCourseItems(panel);
        return items.some((item) => isCourseSelected(item));
      });
      if (enrollable.length === 0) {
        const msg = panels.length === 0 ? "No subjects are listed. Search first, then load your saved courses." : "No courses are selected. Load saved courses first, or select them manually.";
        api2?.logger.warn(msg);
        api2?.statusPanel.addMessage("warn", msg);
        return;
      }
      await ensureTokenFresh();
      api2?.statusPanel.addMessage(
        "info",
        `Enrolling ${enrollable.length} subject${enrollable.length === 1 ? "" : "s"}...`
      );
      let enrolled = 0;
      let failed = 0;
      const errors = [];
      for (const panel of enrollable) {
        const code = extractSubjectCode(panel) ?? "???";
        api2?.logger.info(
          `[enroll-debug] enrolling ${code} (${enrolled + failed + 1}/${enrollable.length})`
        );
        api2?.statusPanel.addMessage(
          "info",
          `Enrolling ${code}... (${enrolled + failed + 1}/${enrollable.length})`
        );
        const enrollStartedAt = performance.now();
        if (!enrollSubject(panel, code)) {
          failed++;
          errors.push(`${code}: enroll button not found`);
          continue;
        }
        const requestResult = await waitForRequestComplete(
          "SubjectApplication/SubjectSignin",
          3e4,
          enrollStartedAt
        );
        if (!requestResult.completed) {
          failed++;
          errors.push(`${code}: timed out waiting for server response`);
          api2?.logger.warn(`[enroll-debug] ${code}: no response within 30s`);
          continue;
        }
        if (requestResult.status !== null && requestResult.status >= 400) {
          failed++;
          errors.push(`${code}: server returned ${requestResult.status}`);
          api2?.logger.warn(
            `[enroll-debug] ${code}: enrollment request completed with status=${requestResult.status}`
          );
          continue;
        }
        enrolled++;
        if (requestResult.status === null) {
          api2?.logger.info(
            `[enroll-debug] ${code}: enrollment request completed (status unavailable)`
          );
        } else {
          api2?.logger.info(
            `[enroll-debug] ${code}: enrollment request completed with status=${requestResult.status}`
          );
        }
      }
      let summary = `Done: ${enrolled} enrolled, ${failed} failed.`;
      if (errors.length > 0) {
        summary += ` Errors: ${errors.join("; ")}`;
      }
      api2?.logger.info(summary);
      api2?.statusPanel.addMessage(enrolled > 0 && failed === 0 ? "info" : "warn", summary);
    } finally {
      setIsEnrolling(false);
    }
  }
  let isLoadAndEnrolling = false;
  async function loadAndEnroll() {
    const api2 = getApi$1();
    if (getIsEnrolling() || isLoadAndEnrolling) {
      api2?.logger.warn("enrollment already in progress");
      return;
    }
    isLoadAndEnrolling = true;
    try {
      const selections = await loadSelections();
      if (Object.keys(selections).length === 0) {
        api2?.statusPanel.addMessage("warn", "No saved course selections. Save courses first.");
        return;
      }
      api2?.statusPanel.addMessage("info", "Loading saved courses...");
      api2?.statusPanel.expand();
      await loadStoredSelections();
      api2?.statusPanel.addMessage("info", "Saved courses loaded. Starting enrollment...");
      await quickEnrollAll();
    } finally {
      isLoadAndEnrolling = false;
    }
  }
  function enrollSubject(panel, subjectCode) {
    const api2 = getApi$1();
    const buttons = Array.from(panel.querySelectorAll("button"));
    const enrollBtn = buttons.find((btn) => isEnrollButtonText(btn.textContent ?? ""));
    if (!enrollBtn) {
      api2?.logger.warn(`enroll button not found for ${subjectCode}`);
      return false;
    }
    enrollBtn.click();
    api2?.logger.info(`[enroll-debug] clicked enroll for ${subjectCode}`);
    return true;
  }
  async function saveCurrentSelections() {
    const api2 = getApi$1();
    const panels = getSubjectPanels();
    api2?.logger.info(`[save-debug] found ${panels.length} panels on page`);
    const existing = await loadSelections();
    let newCount = 0;
    for (const panel of panels) {
      const expanded = isPanelExpanded(panel);
      const headerText = (panel.querySelector("mat-expansion-panel-header")?.textContent ?? "").replace(/\s+/g, " ").trim().substring(0, 50);
      const courseItemCount = panel.querySelectorAll(".course-list-item-container").length;
      const selectedItemCount = panel.querySelectorAll(".course-list-item-container--selected").length;
      api2?.logger.info(
        `[save-debug] panel "${headerText}": expanded=${expanded}, courses=${courseItemCount}, selected=${selectedItemCount}, classes=${panel.className.substring(0, 60)}`
      );
      if (!expanded) continue;
      const code = extractSubjectCode(panel);
      api2?.logger.info(`[save-debug]   subjectCode=${code}`);
      if (!code) continue;
      const items = getCourseItems(panel);
      const selectedCodes = [];
      for (const item of items) {
        const isSelected = isCourseSelected(item);
        const courseCode = extractCourseCode(item);
        api2?.logger.info(
          `[save-debug]   course=${courseCode}, selected=${isSelected}, classes=${item.className.substring(0, 60)}`
        );
        if (isSelected && courseCode) {
          selectedCodes.push(courseCode);
        }
      }
      if (selectedCodes.length > 0) {
        existing[code] = selectedCodes;
        newCount++;
        api2?.logger.info(`[save-debug] saved ${selectedCodes.join(", ")} for ${code}`);
      }
    }
    if (newCount === 0) {
      api2?.logger.warn("no selected courses found in expanded subjects");
      api2?.statusPanel.addMessage(
        "warn",
        "No selected courses found. Expand a subject and select courses first."
      );
      await renderModuleUI$1();
      return;
    }
    await saveSelections(existing);
    const totalSubjects = Object.keys(existing).length;
    api2?.logger.info(`saved/updated ${newCount} subjects, total stored: ${totalSubjects}`, existing);
    api2?.statusPanel.addMessage(
      "info",
      `Saved ${newCount} subject${newCount === 1 ? "" : "s"}. Total stored: ${totalSubjects}.`
    );
    await renderModuleUI$1();
  }
  const COURSE_UI_BUILD = "3.1.2 coursestore-select-a";
  async function renderModuleUI$1() {
    const api2 = getApi$1();
    if (!api2) return;
    const container = document.createElement("div");
    const debugEnabled = isDebugEnabled();
    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "font-weight: bold; margin-bottom: 8px; color: #5c9eff; font-size: 13px;";
    titleDiv.textContent = "Course Store";
    container.appendChild(titleDiv);
    if (debugEnabled) {
      const buildDiv = document.createElement("div");
      buildDiv.style.cssText = "margin-top: -4px; margin-bottom: 6px; font-size: 10px; color: #6a7a8a;";
      buildDiv.textContent = `Build: ${COURSE_UI_BUILD}`;
      container.appendChild(buildDiv);
    }
    const selections = await loadSelections();
    const hasStored = Object.keys(selections).length > 0;
    const storedSubjectCount = Object.keys(selections).length;
    const storedCourseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);
    const btnStyle = `
    padding: 5px 11px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
  `;
    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = "display: flex; flex-wrap: wrap; gap: 5px;";
    const saveBtn = document.createElement("button");
    saveBtn.style.cssText = `${btnStyle} background: #1565c0; color: white;`;
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      saveCurrentSelections().catch((err) => api2?.logger.error("save selections failed:", err));
    });
    btnContainer.appendChild(saveBtn);
    if (hasStored) {
      const count = Object.keys(selections).length;
      const courseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);
      const toggleBtn = document.createElement("button");
      toggleBtn.style.cssText = `${btnStyle} background: #37474f; color: white; margin-bottom: 4px;`;
      toggleBtn.textContent = `Saved (${count} subjects, ${courseCount} courses)`;
      const detailDiv = document.createElement("div");
      detailDiv.style.cssText = "display: none; margin: 4px 0 6px; padding: 5px 7px; background: #0f2040; border-radius: 4px; font-size: 10px; color: #8baae0; max-height: 120px; overflow-y: auto; width: 100%;";
      for (const [subj, courses] of Object.entries(selections)) {
        const row = document.createElement("div");
        row.style.cssText = "padding: 2px 0; border-bottom: 1px solid #1a2a4a; display: flex; justify-content: space-between; align-items: center;";
        const text = document.createElement("span");
        text.textContent = `${subj}: ${courses.join(", ")}`;
        row.appendChild(text);
        const removeBtn = document.createElement("button");
        removeBtn.style.cssText = "margin-left: 6px; padding: 1px 6px; background: #c62828; color: white; border: none; border-radius: 2px; cursor: pointer; font-size: 10px; flex-shrink: 0;";
        removeBtn.textContent = "x";
        removeBtn.title = `Remove saved courses for ${subj}`;
        removeBtn.addEventListener("click", () => {
          removeSingleSubject(subj).then(() => renderModuleUI$1()).catch((err) => api2?.logger.error("remove subject failed:", err));
        });
        row.appendChild(removeBtn);
        detailDiv.appendChild(row);
      }
      toggleBtn.addEventListener("click", () => {
        const isVisible = detailDiv.style.display !== "none";
        detailDiv.style.display = isVisible ? "none" : "block";
        toggleBtn.textContent = isVisible ? `Saved (${count} subjects, ${courseCount} courses)` : "Hide saved";
      });
      container.appendChild(toggleBtn);
      container.appendChild(detailDiv);
      const loadBtn = document.createElement("button");
      loadBtn.style.cssText = `${btnStyle} background: #2e7d32; color: white;`;
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", () => {
        loadStoredSelections().catch((err) => api2?.logger.error("load selections failed:", err));
      });
      btnContainer.appendChild(loadBtn);
      const loadEnrollBtn = document.createElement("button");
      loadEnrollBtn.style.cssText = `${btnStyle} background: #d84315; color: white; font-weight: bold;`;
      loadEnrollBtn.textContent = "Load + Enroll";
      loadEnrollBtn.title = "Load saved courses, then enroll each subject";
      loadEnrollBtn.addEventListener("click", () => {
        if (getIsEnrolling()) return;
        loadAndEnroll().catch((err) => api2?.logger.error("load & enroll failed:", err));
      });
      btnContainer.appendChild(loadEnrollBtn);
      const enrollBtn = document.createElement("button");
      enrollBtn.style.cssText = `${btnStyle} background: #e65100; color: white;`;
      enrollBtn.textContent = "Enroll Selected";
      enrollBtn.title = "Enroll subjects with courses already selected";
      enrollBtn.addEventListener("click", () => {
        if (getIsEnrolling()) return;
        quickEnrollAll().catch((err) => api2?.logger.error("quick enroll failed:", err));
      });
      btnContainer.appendChild(enrollBtn);
      const clearBtn = document.createElement("button");
      clearBtn.style.cssText = `${btnStyle} background: #c62828; color: white;`;
      clearBtn.textContent = "Clear Saved";
      clearBtn.addEventListener("click", () => {
        handleClear().catch((err) => api2?.logger.error("clear selections failed:", err));
      });
      btnContainer.appendChild(clearBtn);
    }
    container.appendChild(btnContainer);
    const hint = document.createElement("div");
    hint.style.cssText = "margin-top: 6px; font-size: 10px; color: #6a7a8a;";
    hint.textContent = "Expand subjects and select courses before saving.";
    container.appendChild(hint);
    if (debugEnabled) {
      const diagnosticsDiv = document.createElement("div");
      diagnosticsDiv.style.cssText = "margin-top: 4px; font-size: 10px; color: #8baae0;";
      diagnosticsDiv.textContent = `Stored subjects: ${storedSubjectCount} | Stored courses: ${storedCourseCount}`;
      container.appendChild(diagnosticsDiv);
      const rushHintDiv = document.createElement("div");
      rushHintDiv.style.cssText = "margin-top: 4px; font-size: 10px; color: #6a7a8a;";
      rushHintDiv.textContent = "Course Rush turns off after a run starts.";
      container.appendChild(rushHintDiv);
    }
    api2.statusPanel.setModuleContentElement(container);
  }
  async function handleClear() {
    const api2 = getApi$1();
    await clearSelections();
    api2?.logger.info("cleared all stored course selections");
    api2?.statusPanel.addMessage("info", "All stored selections cleared.");
    await renderModuleUI$1();
  }
  const courseStoreModule = {
    id: "course-store",
    name: "Course Store",
    description: "Save course selections and restore them later",
    shouldActivate(context) {
      return context.path.includes("/subjects/registration");
    },
    async initialize(moduleApi) {
      setApi$1(moduleApi);
      const api2 = moduleApi;
      await renderModuleUI$1();
      const selections = await loadSelections();
      const count = Object.keys(selections).length;
      if (count > 0) {
        const courseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);
        api2.statusPanel.addMessage(
          "info",
          `${count} saved subject${count === 1 ? "" : "s"}, ${courseCount} course${courseCount === 1 ? "" : "s"}. Use Load to restore.`
        );
        api2.logger.info(`found ${count} stored subject selection(s)`);
      }
      setRouteUnsub(
        api2.bus.on("page:changed", (payload) => {
          if (payload.path.includes("/subjects/registration")) {
            const currentApi = getApi$1();
            if (!currentApi) return;
            renderModuleUI$1().then(async () => {
              const freshApi = getApi$1();
              if (!freshApi) return;
              const sel = await loadSelections();
              const storedSubjects = Object.keys(sel).length;
              if (storedSubjects > 0) {
                const storedCourses = Object.values(sel).reduce((sum, arr) => sum + arr.length, 0);
                freshApi.statusPanel.addMessage(
                  "info",
                  `${storedSubjects} saved subject${storedSubjects === 1 ? "" : "s"}, ${storedCourses} course${storedCourses === 1 ? "" : "s"}. Use Load to restore.`
                );
              }
            }).catch((err) => {
              const freshApi = getApi$1();
              const log = freshApi?.logger ?? console;
              log.error("error in route change handler:", err);
            });
          }
        })
      );
      const autoSearchResult = await autoSearchSubjects();
      const rushOn = api2.statusPanel.getCourseRushMode();
      if (rushOn) {
        const rushSelections = await loadSelections();
        if (Object.keys(rushSelections).length > 0) {
          api2.logger.info("Course Rush Mode active - auto-triggering Load & Enroll");
          api2.statusPanel.addMessage("info", "Course Rush is enrolling saved courses...");
          api2.statusPanel.setCourseRushMode(false);
          api2.statusPanel.addMessage("info", "Course Rush started and turned itself off.");
          let panelCount = getSubjectPanels().length;
          if (panelCount === 0) {
            const listingResult = await waitForSubjectListing({
              timeoutMs: 6e4,
              searchStartedAtMs: autoSearchResult.searchStartedAtMs ?? performance.now(),
              allowAutoClick: !autoSearchResult.clickedSearchButton
            });
            panelCount = listingResult.panels;
            if (panelCount === 0) {
              if (listingResult.state === "request-failed" && listingResult.requestStatus !== null) {
                api2.logger.warn(
                  `Rush Mode: subject search failed with status ${listingResult.requestStatus}`
                );
                api2.statusPanel.addMessage(
                  "warn",
                  `Subject search failed (${listingResult.requestStatus}). Registration may not be open yet.`
                );
              } else if (listingResult.state === "request-completed-no-panels") {
                api2.logger.warn("Rush Mode: subject search completed but no subjects were listed");
                api2.statusPanel.addMessage(
                  "warn",
                  "Subject search completed, but no subjects were listed. Check filters or registration availability."
                );
              } else {
                api2.logger.warn(
                  "Rush Mode: timed out waiting for subject listing - cannot auto-enroll"
                );
                api2.statusPanel.addMessage(
                  "warn",
                  "Timed out waiting for subjects to load. Try refreshing and enabling Rush Mode again."
                );
              }
              return;
            }
          }
          if (panelCount === 0) {
            api2.logger.warn("Rush Mode: no subjects are listed - cannot auto-enroll");
            api2.statusPanel.addMessage(
              "warn",
              "No subjects loaded. Try refreshing and enabling Rush Mode again."
            );
            return;
          }
          loadAndEnroll().catch((err) => api2.logger.error("rush auto-enroll failed:", err));
        }
      }
      api2.logger.info("initialized on registration page");
    },
    dispose() {
      setIsEnrolling(false);
      getRouteUnsub()?.();
      setRouteUnsub(null);
      setApi$1(null);
    }
  };
  const STORAGE_KEY = "examPreferences";
  const HIGHLIGHT_STYLE = "background-color: rgba(76, 175, 80, 0.15) !important; border-left: 3px solid #4caf50 !important;";
  let api = null;
  let tableObserver = null;
  let debounceTimer = null;
  let isDisposed = false;
  let cachedSubjectCode = void 0;
  function getApi() {
    return api;
  }
  function setApi(value) {
    api = value;
  }
  function getTableObserver() {
    return tableObserver;
  }
  function setTableObserver(value) {
    tableObserver = value;
  }
  function getDebounceTimer() {
    return debounceTimer;
  }
  function setDebounceTimer(value) {
    debounceTimer = value;
  }
  function getIsDisposed() {
    return isDisposed;
  }
  function setIsDisposed(value) {
    isDisposed = value;
  }
  function getCachedSubjectCode() {
    return cachedSubjectCode;
  }
  function setCachedSubjectCode(value) {
    cachedSubjectCode = value;
  }
  function getSubjectCodeFromElements(elements) {
    for (const element of elements) {
      const text = element?.textContent ?? "";
      const code = extractSubjectCodeFromText(text);
      if (code) return code;
    }
    return null;
  }
  function getStableOwnText(element) {
    return Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
  }
  function getStandaloneSubjectCode(element) {
    if (!["P", "DIV", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6"].includes(element.tagName)) {
      return null;
    }
    const ownText = getStableOwnText(element);
    if (!ownText || ownText.length > 40) return null;
    const code = extractSubjectCodeFromText(ownText);
    return code && code === ownText.replace(/\s+/g, "").toUpperCase() ? code : null;
  }
  function getCellText(cell) {
    if (!cell) return "";
    const clone = cell.cloneNode(true);
    clone.querySelectorAll(".npu-exam-save-slot, .npu-exam-save-btn").forEach((node) => node.remove());
    return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  function getEnrollmentButton(row) {
    const buttons = Array.from(row.querySelectorAll("button"));
    const submitButton = buttons.find((button) => {
      const text = (button.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return text.includes("felv");
    });
    return submitButton ?? null;
  }
  function buildTableSubjectCodeMap() {
    const map = new Map();
    const root = document.querySelector("main") ?? document.body;
    if (!root) return map;
    let currentCode = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let currentNode = walker.currentNode;
    while (currentNode) {
      const code = getStandaloneSubjectCode(currentNode);
      if (code) {
        currentCode = code;
      } else if (currentNode.tagName === "TABLE" && currentCode) {
        map.set(currentNode, currentCode);
      }
      currentNode = walker.nextNode();
    }
    return map;
  }
  function getSubjectCodeForTable(table) {
    if (!table) return null;
    return buildTableSubjectCodeMap().get(table) ?? null;
  }
  function getRowSubjectCode(row) {
    return getSubjectCodeForTable(row.closest("table"));
  }
  function getPageSubjectCodes() {
    const uniqueCodes = new Set();
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const code = getSubjectCodeForTable(table);
      if (code) uniqueCodes.add(code);
    }
    return Array.from(uniqueCodes);
  }
  function getSubjectCode() {
    const api2 = getApi();
    const cached = getCachedSubjectCode();
    if (cached !== void 0) {
      api2?.logger.info(`[exam-dom-debug] getSubjectCode: returning cached="${cached}"`);
      return cached;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const subjectName = params.get("subjectName") ?? "";
      const code = extractSubjectCodeFromText(subjectName);
      if (code) {
        api2?.logger.info(`[exam-dom-debug] getSubjectCode: found via URL param, code="${code}"`);
        setCachedSubjectCode(code);
        return code;
      }
    } catch {
    }
    const h1 = document.querySelector("h1");
    if (h1) {
      const code = getSubjectCodeFromElements([
        h1,
        h1.previousElementSibling,
        h1.nextElementSibling,
        h1.closest("section"),
        h1.closest("article"),
        h1.closest("mat-card")
      ]);
      if (code) {
        api2?.logger.info(`[exam-dom-debug] getSubjectCode: found near heading, code="${code}"`);
        setCachedSubjectCode(code);
        return code;
      }
    }
    const pageSubjectCodes = getPageSubjectCodes();
    if (pageSubjectCodes.length === 1) {
      api2?.logger.info(`[exam-dom-debug] getSubjectCode: found single page subject code="${pageSubjectCodes[0]}"`);
      setCachedSubjectCode(pageSubjectCodes[0]);
      return pageSubjectCodes[0];
    }
    if (pageSubjectCodes.length > 1) {
      api2?.logger.info("[exam-dom-debug] getSubjectCode: multiple subject tables detected, no single page subject code");
    }
    api2?.logger.warn("[exam-dom-debug] getSubjectCode: no subject code found on page");
    setCachedSubjectCode(null);
    return null;
  }
  function getSubjectName() {
    const h1 = document.querySelector("h1");
    return h1?.textContent?.trim() ?? null;
  }
  function getExamRows() {
    const rows = Array.from(document.querySelectorAll("table tr"));
    return rows.filter((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 4) return false;
      const actionButton = row.querySelector("button");
      return !!actionButton;
    });
  }
  function parseExamRow(row) {
    const api2 = getApi();
    const cells = Array.from(row.querySelectorAll("td"));
    const felvetelBtn = getEnrollmentButton(row);
    if (cells.length < 4) {
      api2?.logger.warn(`[exam-dom-debug] parseExamRow: only ${cells.length} cells, expected 4+`);
    }
    if (!felvetelBtn) {
      api2?.logger.warn("[exam-dom-debug] parseExamRow: action button not found on row");
    }
    const cellTexts = cells.map((c) => getCellText(c));
    const isCompactLayout = cells.length === 4;
    const date = cellTexts[0] ?? "";
    const type = cellTexts[1] ?? "";
    const capacity = cellTexts[2] ?? "";
    const instructor = isCompactLayout ? "" : cellTexts[3] ?? "";
    const courseCode = isCompactLayout ? "" : cellTexts[4] ?? "";
    return {
      row,
      date,
      type,
      capacity,
      instructor,
      courseCode,
      felvetelBtn
    };
  }
  function addSaveButtonsToRows(subjectCode, onSave) {
    const api2 = getApi();
    document.querySelectorAll(".npu-exam-save-btn").forEach((b) => b.remove());
    document.querySelectorAll(".npu-exam-save-slot").forEach((slot) => slot.remove());
    const rows = getExamRows();
    api2?.logger.info(`[exam-dom-debug] addSaveButtonsToRows: processing ${rows.length} exam rows for ${subjectCode}`);
    let addedCount = 0;
    for (const row of rows) {
      const info = parseExamRow(row);
      const resolvedSubjectCode = getSubjectCodeForTable(row.closest("table")) ?? subjectCode;
      if (!resolvedSubjectCode) {
        api2?.logger.warn(`[exam-dom-debug] addSaveButtonsToRows: no subjectCode resolved for row date="${info.date}"`);
        continue;
      }
      const firstCell = row.querySelector("td");
      if (!firstCell) {
        api2?.logger.warn(`[exam-dom-debug] addSaveButtonsToRows: firstCell not found for row date="${info.date}"`);
        continue;
      }
      addedCount++;
      firstCell.setAttribute("data-npu-save-host", "true");
      firstCell.style.position = "relative";
      const saveSlot = document.createElement("div");
      saveSlot.className = "npu-exam-save-slot";
      saveSlot.style.cssText = "position: absolute; top: 8px; right: 8px; z-index: 3;";
      const saveBtn = document.createElement("button");
      saveBtn.className = "npu-exam-save-btn";
      saveBtn.style.cssText = "padding: 2px 8px; background: #f6faff; color: #0f5bd8; border: 1px solid #b7cdf8; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; letter-spacing: 0; box-shadow: none;";
      saveBtn.textContent = "Save";
      saveBtn.title = `Save "${info.date}" as preferred exam date for ${resolvedSubjectCode}`;
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onSave(resolvedSubjectCode, info.date, info.type, info.courseCode);
      });
      saveSlot.appendChild(saveBtn);
      firstCell.appendChild(saveSlot);
    }
    api2?.logger.info(`[exam-dom-debug] addSaveButtonsToRows: added ${addedCount} save buttons`);
    return {
      addedCount,
      rowCount: rows.length
    };
  }
  function watchTableForReRenders(subjectCode, onSave) {
    const api2 = getApi();
    getTableObserver()?.disconnect();
    const timer = getDebounceTimer();
    if (timer) {
      clearTimeout(timer);
      setDebounceTimer(null);
    }
    const observerTarget = document.querySelector("main") ?? document.body;
    if (!observerTarget) {
      api2?.logger.info("[exam-dom-debug] watchTableForReRenders: skipping, no observer target");
      return;
    }
    const newObserver = new MutationObserver((mutations) => {
      if (getIsDisposed()) return;
      const hasRelevantMutation = mutations.some((mutation) => {
        const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
        if (changedNodes.length === 0) return false;
        return changedNodes.some((node) => {
          if (!(node instanceof Element)) return true;
          if (node.closest("#npu-status-root")) return false;
          if (node.classList.contains("npu-exam-save-slot") || node.closest(".npu-exam-save-slot")) return false;
          if (node.classList.contains("npu-exam-save-btn") || node.closest(".npu-exam-save-btn")) return false;
          return true;
        });
      });
      if (!hasRelevantMutation) return;
      const currentTimer = getDebounceTimer();
      if (currentTimer) clearTimeout(currentTimer);
      setDebounceTimer(setTimeout(() => {
        if (!getIsDisposed()) addSaveButtonsToRows(subjectCode, onSave);
      }, 300));
    });
    newObserver.observe(observerTarget, { childList: true, subtree: true });
    setTableObserver(newObserver);
    api2?.logger.info("[exam-dom-debug] watchTableForReRenders: MutationObserver attached to page container");
  }
  function highlightSavedRow(pref) {
    clearHighlights();
    const rows = getExamRows();
    for (const row of rows) {
      const info = parseExamRow(row);
      if (info.date === pref.date) {
        row.setAttribute("style", HIGHLIGHT_STYLE);
        row.setAttribute("data-npu-highlighted", "true");
      }
    }
  }
  function clearHighlights() {
    const highlighted = document.querySelectorAll("[data-npu-highlighted]");
    highlighted.forEach((el) => {
      el.removeAttribute("style");
      el.removeAttribute("data-npu-highlighted");
    });
  }
  async function loadPreferences() {
    const api2 = getApi();
    if (!api2) return {};
    const raw = await api2.storage.getForDomain(STORAGE_KEY) ?? {};
    const valid = {};
    for (const [code, pref] of Object.entries(raw)) {
      if (pref && typeof pref.date === "string" && pref.date.length > 0) {
        valid[code] = pref;
      }
    }
    return valid;
  }
  async function savePreferences(prefs) {
    const api2 = getApi();
    if (!api2) return;
    await api2.storage.setForDomain(STORAGE_KEY, prefs);
  }
  function isCurrentEnrollmentRun(apiRef) {
    return !getIsDisposed() && getApi() === apiRef;
  }
  function resolveCurrentTargetInfo(target) {
    for (const row of getExamRows()) {
      const subjectCode = getRowSubjectCode(row);
      if (subjectCode !== target.subjectCode) continue;
      const info = parseExamRow(row);
      if (info.date !== target.pref.date) continue;
      return info;
    }
    return null;
  }
  function getLatestNotificationSummary() {
    const candidates = Array.from(document.querySelectorAll("body *")).map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()).filter(
      (text) => text.length > 0 && text.length < 220 && /siker|sikertelen|hiba|nem enged[ée]lyezett|vizsgajelentkez/i.test(text)
    );
    return candidates[0] ?? null;
  }
  function findSavedExamTargets(prefs) {
    const targets = [];
    for (const row of getExamRows()) {
      const subjectCode = getRowSubjectCode(row);
      if (!subjectCode) continue;
      const pref = prefs[subjectCode];
      if (!pref) continue;
      const info = parseExamRow(row);
      if (info.date !== pref.date) continue;
      targets.push({ subjectCode, pref, info });
    }
    return targets;
  }
  async function submitEnrollmentTarget(target) {
    const api2 = getApi();
    const { subjectCode, pref } = target;
    const info = resolveCurrentTargetInfo(target);
    if (!info) {
      api2?.logger.warn(
        `[exam-enroll-debug] submitEnrollmentTarget: live row not found for ${subjectCode} ${pref.date}`
      );
      api2?.statusPanel.addMessage("warn", `${subjectCode}: saved exam row is not visible.`);
      return { failed: true, submitted: false, shouldStop: false };
    }
    if (!info.felvetelBtn) {
      api2?.logger.warn(
        `[exam-enroll-debug] submitEnrollmentTarget: button not found for ${subjectCode} ${pref.date}`
      );
      api2?.statusPanel.addMessage("warn", `${subjectCode}: enrollment button is missing.`);
      return { failed: true, submitted: false, shouldStop: false };
    }
    if (!info.felvetelBtn.isConnected) {
      api2?.logger.warn(
        `[exam-enroll-debug] submitEnrollmentTarget: button became detached for ${subjectCode} ${pref.date}`
      );
      api2?.statusPanel.addMessage("warn", `${subjectCode}: enrollment button changed before click.`);
      return { failed: true, submitted: false, shouldStop: false };
    }
    if (info.felvetelBtn.disabled || info.felvetelBtn.hasAttribute("disabled")) {
      api2?.logger.info(
        `[exam-enroll-debug] submitEnrollmentTarget: button disabled for ${subjectCode}`
      );
      api2?.statusPanel.addMessage("warn", `${subjectCode}: registration button is disabled.`);
      return { failed: true, submitted: false, shouldStop: false };
    }
    const capacityMatch = /(\d+)\s*\/\s*(\d+)/.exec(info.capacity);
    if (capacityMatch) {
      const current = parseInt(capacityMatch[1], 10);
      const limit = parseInt(capacityMatch[2], 10);
      api2?.logger.info(
        `[exam-enroll-debug] submitEnrollmentTarget: ${subjectCode} capacity ${current}/${limit}`
      );
      if (current >= limit) {
        api2?.statusPanel.addMessage(
          "warn",
          `${subjectCode}: saved exam is full (${current}/${limit}).`
        );
        return { failed: true, submitted: false, shouldStop: false };
      }
    }
    api2?.logger.info(
      `[exam-enroll-debug] submitEnrollmentTarget: clicking Felvétel for ${subjectCode} ${pref.date}`
    );
    api2?.statusPanel.addMessage("info", `Auto-enrolling ${subjectCode}: ${pref.date}...`);
    api2?.statusPanel.expand();
    const requestStartedAt = performance.now();
    const requestPromise = waitForRequestComplete(
      "ExamRegistration/SignUpForExam",
      3e4,
      requestStartedAt
    );
    info.felvetelBtn.click();
    await delay(500);
    if (isCurrentEnrollmentRun(api2)) {
      const confirmBtn = findConfirmButton();
      if (confirmBtn) {
        api2?.logger.info("[exam-enroll-debug] dialog found, confirming");
        confirmBtn.click();
        const closeStart = Date.now();
        while (Date.now() - closeStart < 2e3 && isCurrentEnrollmentRun(api2)) {
          if (!findConfirmButton()) break;
          await delay(100);
        }
      } else {
        api2?.logger.info("[exam-enroll-debug] no dialog - enrollment submitted directly");
      }
    }
    if (isCurrentEnrollmentRun(api2)) {
      await delay(500);
    }
    if (!isCurrentEnrollmentRun(api2)) {
      return { failed: false, submitted: false, shouldStop: true };
    }
    const requestResult = await requestPromise;
    if (!isCurrentEnrollmentRun(api2)) {
      return { failed: false, submitted: false, shouldStop: true };
    }
    if (!requestResult.completed) {
      api2?.logger.warn(
        `[exam-enroll-debug] submitEnrollmentTarget: no server response for ${subjectCode}`
      );
      api2?.statusPanel.addMessage(
        "warn",
        `${subjectCode}: no server response after clicking Felvétel.`
      );
      return { failed: true, submitted: false, shouldStop: false };
    }
    if (requestResult.status !== null && requestResult.status >= 400) {
      const notificationSummary = getLatestNotificationSummary();
      api2?.logger.warn(
        `[exam-enroll-debug] submitEnrollmentTarget: request failed for ${subjectCode} with status=${requestResult.status}`
      );
      api2?.statusPanel.addMessage(
        "warn",
        notificationSummary ? `${subjectCode}: ${notificationSummary}` : `${subjectCode}: server returned ${requestResult.status}.`
      );
      return { failed: true, submitted: false, shouldStop: false };
    }
    api2?.statusPanel.addMessage("info", `Enrollment submitted for ${subjectCode}: ${pref.date}.`);
    return { failed: false, submitted: true, shouldStop: false };
  }
  async function autoEnrollSaved() {
    const api2 = getApi();
    const prefs = await loadPreferences();
    if (Object.keys(prefs).length === 0) {
      api2?.logger.info("[exam-enroll-debug] autoEnrollSaved: no saved preferences found");
      api2?.statusPanel.addMessage("info", "No saved exam dates found.");
      return;
    }
    const pageSubjectCode = getSubjectCode();
    const targets = findSavedExamTargets(prefs);
    api2?.logger.info(
      `[exam-enroll-debug] autoEnrollSaved: found ${targets.length} saved targets on the current page`
    );
    if (targets.length === 0) {
      if (pageSubjectCode && prefs[pageSubjectCode]) {
        api2?.logger.warn(
          `[exam-enroll-debug] autoEnrollSaved: saved exam date "${prefs[pageSubjectCode].date}" not found on current page`
        );
        api2?.statusPanel.addMessage(
          "warn",
          `Saved exam date "${prefs[pageSubjectCode].date}" not found on this page.`
        );
      } else {
        api2?.logger.info(
          "[exam-enroll-debug] autoEnrollSaved: no saved exam targets visible on this page"
        );
        api2?.statusPanel.addMessage("info", "No saved exam dates are visible on this page.");
      }
      showRetryButton();
      return;
    }
    api2?.statusPanel.addMessage(
      "info",
      `Exam Rush: ${targets.length} saved target${targets.length === 1 ? "" : "s"} visible.`
    );
    api2?.statusPanel.setExamRushMode(false);
    api2?.statusPanel.addMessage("info", "Exam Rush started and turned itself off.");
    let failedCount = 0;
    let submittedCount = 0;
    let stoppedEarly = false;
    for (const target of targets) {
      if (!isCurrentEnrollmentRun(api2)) {
        break;
      }
      const result = await submitEnrollmentTarget(target);
      if (result.submitted) {
        submittedCount++;
        await delay(250);
      }
      if (result.failed) {
        failedCount++;
        await delay(250);
      }
      if (result.shouldStop) {
        stoppedEarly = true;
        break;
      }
    }
    if (!isCurrentEnrollmentRun(api2)) {
      return;
    }
    if (submittedCount === 0 && failedCount === 0) {
      api2?.statusPanel.addMessage("warn", "Exam Rush did not submit any visible saved exams.");
      showRetryButton();
    } else if (stoppedEarly) {
      api2?.statusPanel.addMessage(
        "warn",
        `Exam Rush stopped early: ${submittedCount} submitted, ${failedCount} failed.`
      );
    } else if (failedCount > 0) {
      api2?.statusPanel.addMessage(
        "warn",
        `Exam Rush finished: ${submittedCount} submitted, ${failedCount} failed.`
      );
    } else {
      api2?.statusPanel.addMessage(
        "info",
        `Exam Rush submitted ${submittedCount} saved exam${submittedCount === 1 ? "" : "s"}.`
      );
    }
  }
  function showRetryButton() {
    const api2 = getApi();
    if (!api2) return;
    document.querySelector(".npu-exam-retry-btn")?.remove();
    const retryBtn = document.createElement("button");
    retryBtn.className = "npu-exam-retry-btn";
    retryBtn.style.cssText = "padding: 4px 12px; background: #e65100; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold; margin-top: 4px; display: block;";
    retryBtn.textContent = "Retry Enrollment";
    retryBtn.addEventListener("click", () => {
      retryBtn.remove();
      autoEnrollSaved().catch((err) => api2?.logger.error("retry auto-enroll failed:", err));
    });
    document.body.appendChild(retryBtn);
    retryBtn.style.position = "fixed";
    retryBtn.style.bottom = "60px";
    retryBtn.style.right = "20px";
    retryBtn.style.zIndex = "99998";
  }
  function findConfirmButton() {
    const api2 = getApi();
    const overlay = document.querySelector(".cdk-overlay-container");
    if (!overlay) {
      api2?.logger.info("[exam-enroll-debug] findConfirmButton: no overlay container found");
      return null;
    }
    const buttons = Array.from(overlay.querySelectorAll("button"));
    api2?.logger.info(`[exam-enroll-debug] findConfirmButton: ${buttons.length} buttons in overlay`);
    const btn = buttons.find((b) => {
      const text = (b.textContent ?? "").trim();
      return /meger[oő]s[ií]t/i.test(text) || text.includes("Igen") || text.includes("OK");
    });
    if (btn) {
      api2?.logger.info(
        `[exam-enroll-debug] findConfirmButton: matched button text="${(btn.textContent ?? "").trim().substring(0, 30)}"`
      );
    }
    return btn ?? null;
  }
  async function waitForExamTable(timeoutMs) {
    const api2 = getApi();
    const start = Date.now();
    let pollCount = 0;
    api2?.logger.info(`[exam-enroll-debug] waitForExamTable: starting poll, timeout=${timeoutMs}ms`);
    while (Date.now() - start < timeoutMs) {
      const rowCount = getExamRows().length;
      if (rowCount > 0) {
        api2?.logger.info(
          `[exam-enroll-debug] waitForExamTable: found ${rowCount} rows after ${pollCount} polls (${Date.now() - start}ms)`
        );
        return true;
      }
      pollCount++;
      await delay(300);
    }
    api2?.logger.warn(
      `[exam-enroll-debug] waitForExamTable: timed out after ${pollCount} polls (${timeoutMs}ms)`
    );
    return false;
  }
  const EXAM_UI_BUILD = "3.1.0 publish-prep-a";
  async function savePreferredExam(subjectCode, date, type, courseCode) {
    const api2 = getApi();
    const prefs = await loadPreferences();
    prefs[subjectCode] = { date, type, courseCode };
    await savePreferences(prefs);
    api2?.logger.info(`saved exam preference for ${subjectCode}: ${date}`);
    api2?.statusPanel.addMessage("info", `Saved exam date: ${date}`);
    await renderModuleUI();
  }
  async function clearPreference(subjectCode) {
    const api2 = getApi();
    const prefs = await loadPreferences();
    delete prefs[subjectCode];
    await savePreferences(prefs);
    api2?.logger.info(`cleared exam preference for ${subjectCode}`);
    api2?.statusPanel.addMessage("info", "Saved exam date cleared.");
    clearHighlights();
    await renderModuleUI();
  }
  async function renderModuleUI() {
    const api2 = getApi();
    if (!api2) return;
    const container = document.createElement("div");
    container.style.cssText = "font-size: 12px;";
    const debugEnabled = isDebugEnabled();
    const heading = document.createElement("div");
    heading.style.cssText = "font-weight: bold; color: #5c9eff; margin-bottom: 6px;";
    heading.textContent = "Exam Quick Signup";
    container.appendChild(heading);
    if (debugEnabled) {
      const buildDiv = document.createElement("div");
      buildDiv.style.cssText = "margin-top: -2px; margin-bottom: 6px; font-size: 10px; color: #6a7a8a;";
      buildDiv.textContent = `Build: ${EXAM_UI_BUILD}`;
      container.appendChild(buildDiv);
    }
    const subjectCode = getSubjectCode();
    const subjectName = getSubjectName();
    const prefs = await loadPreferences();
    const currentPref = subjectCode ? prefs[subjectCode] : null;
    const btnStyle = "padding: 4px 10px; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; margin: 2px;";
    if (currentPref) {
      const savedDiv = document.createElement("div");
      savedDiv.style.cssText = "padding: 4px 6px; background: #0f2040; border-radius: 3px; margin-bottom: 6px; color: #8baae0; font-size: 11px;";
      savedDiv.textContent = `Saved exam: ${currentPref.date} (${subjectCode})`;
      container.appendChild(savedDiv);
      const autoBtn = document.createElement("button");
      autoBtn.style.cssText = `${btnStyle} background: #d84315; color: white; font-weight: bold;`;
      autoBtn.textContent = "Try Enroll";
      autoBtn.title = "Click Felvétel for the saved exam date";
      autoBtn.addEventListener("click", () => {
        autoEnrollSaved().catch((err) => api2?.logger.error("auto-enroll failed:", err));
      });
      container.appendChild(autoBtn);
      const clearBtn = document.createElement("button");
      clearBtn.style.cssText = `${btnStyle} background: #c62828; color: white;`;
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", () => {
        if (subjectCode) {
          clearPreference(subjectCode).catch((err) => api2?.logger.error("clear failed:", err));
        }
      });
      container.appendChild(clearBtn);
      highlightSavedRow(currentPref);
    } else {
      const infoDiv = document.createElement("div");
      infoDiv.style.cssText = "color: #9e9e9e; margin-bottom: 6px;";
      infoDiv.textContent = "Use Save under an exam date to remember it.";
      container.appendChild(infoDiv);
    }
    const allPrefsEntries = Object.entries(prefs);
    if (allPrefsEntries.length > 0) {
      const toggleBtn = document.createElement("button");
      toggleBtn.style.cssText = `${btnStyle} background: #37474f; color: white; margin-top: 6px; display: block;`;
      toggleBtn.textContent = `Saved exams (${allPrefsEntries.length})`;
      const allSavedDiv = document.createElement("div");
      allSavedDiv.style.cssText = "display: none; padding: 6px; background: #0f2040; border-radius: 3px; margin-top: 4px; max-height: 120px; overflow-y: auto; font-size: 11px; color: #8baae0;";
      for (const [code, pref] of allPrefsEntries) {
        const row = document.createElement("div");
        row.style.cssText = "padding: 2px 0; border-bottom: 1px solid #1a2a4a;";
        const text = document.createElement("span");
        text.textContent = `${code}: ${pref.date}`;
        if (code === subjectCode) {
          text.style.fontWeight = "bold";
          text.style.color = "#5c9eff";
        }
        row.appendChild(text);
        const removeBtn = document.createElement("button");
        removeBtn.style.cssText = "margin-left: 8px; padding: 1px 6px; background: #c62828; color: white; border: none; border-radius: 2px; cursor: pointer; font-size: 10px;";
        removeBtn.textContent = "x";
        removeBtn.title = `Remove saved exam for ${code}`;
        removeBtn.addEventListener("click", () => {
          clearPreference(code).catch((err) => api2?.logger.error("clear failed:", err));
        });
        row.appendChild(removeBtn);
        allSavedDiv.appendChild(row);
      }
      toggleBtn.addEventListener("click", () => {
        const isVisible = allSavedDiv.style.display !== "none";
        allSavedDiv.style.display = isVisible ? "none" : "block";
        toggleBtn.textContent = isVisible ? `Saved exams (${allPrefsEntries.length})` : `Hide saved exams`;
      });
      container.appendChild(toggleBtn);
      container.appendChild(allSavedDiv);
    }
    const onSave = (sc, date, type, courseCode) => {
      savePreferredExam(sc, date, type, courseCode).catch(
        (err) => api2?.logger.error("save exam pref failed:", err)
      );
    };
    const injectionStats = addSaveButtonsToRows(subjectCode, onSave);
    watchTableForReRenders(subjectCode, onSave);
    if (debugEnabled) {
      const diagnosticsDiv = document.createElement("div");
      diagnosticsDiv.style.cssText = "margin-top: 6px; font-size: 10px; color: #8baae0;";
      diagnosticsDiv.textContent = `Rows detected: ${injectionStats.rowCount} | Save buttons injected: ${injectionStats.addedCount}`;
      container.appendChild(diagnosticsDiv);
      const overviewHintDiv = document.createElement("div");
      overviewHintDiv.style.cssText = "margin-top: 4px; font-size: 10px; color: #6a7a8a;";
      overviewHintDiv.textContent = subjectCode ? `Current subject: ${subjectCode}` : "Exam Rush scans visible subject tables for saved targets.";
      container.appendChild(overviewHintDiv);
    }
    if (debugEnabled && subjectName) {
      const subjectDiv = document.createElement("div");
      subjectDiv.style.cssText = "margin-top: 4px; font-size: 10px; color: #6a7a8a;";
      subjectDiv.textContent = `Subject: ${subjectName}`;
      container.appendChild(subjectDiv);
    }
    api2.statusPanel.setModuleContentElement(container);
  }
  const examSignupModule = {
    id: "exam-signup",
    name: "Exam Quick Signup",
    description: "Save exam dates and try enrolling them from the current page",
    shouldActivate(context) {
      return /\/exams\/overview\/registration\/?$/.test(context.path);
    },
    async initialize(moduleApi) {
      setApi(moduleApi);
      setIsDisposed(false);
      const api2 = moduleApi;
      const tableReady = await waitForExamTable(5e3);
      if (!tableReady) {
        api2.logger.warn("exam table not found after 5s");
        return;
      }
      await renderModuleUI();
      const subjectCode = getSubjectCode();
      if (subjectCode) {
        const prefs = await loadPreferences();
        if (prefs[subjectCode]) {
          api2.logger.info(`found saved exam preference for ${subjectCode}, ready to auto-enroll`);
        }
      }
      const rushOn = api2.statusPanel.getExamRushMode();
      if (rushOn) {
        api2.logger.info("Exam Rush Mode active - scanning visible exam tables for saved targets");
        api2.statusPanel.addMessage("info", "Scanning visible exam tables...");
        await delay(1e3);
        autoEnrollSaved().catch((err) => api2.logger.error("rush exam auto-enroll failed:", err));
      }
      api2.logger.info("initialized on exam page");
    },
    dispose() {
      setIsDisposed(true);
      const timer = getDebounceTimer();
      if (timer) {
        clearTimeout(timer);
        setDebounceTimer(null);
      }
      getTableObserver()?.disconnect();
      setTableObserver(null);
      clearHighlights();
      document.querySelectorAll(".npu-exam-save-btn").forEach((b) => b.remove());
      document.querySelectorAll(".npu-exam-save-slot").forEach((slot) => slot.remove());
      document.querySelectorAll(".npu-exam-retry-btn").forEach((b) => b.remove());
      setCachedSubjectCode(void 0);
      setApi(null);
    }
  };
  const CONSENT_KEY = "consentAccepted";
  async function hasConsent(storage) {
    const accepted = await storage.getForDomain(CONSENT_KEY);
    return accepted === true;
  }
  async function storeConsent(storage) {
    await storage.setForDomain(CONSENT_KEY, true);
  }
  async function resetConsent(storage) {
    await storage.setForDomain(CONSENT_KEY, false);
  }
  function showConsentDialog(version) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = "npu-consent-overlay";
      overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    `;
      const dialog = document.createElement("div");
      dialog.style.cssText = `
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 24px 28px;
      max-width: 440px;
      width: 90%;
      color: #e0e0e0;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    `;
      const titleSection = document.createElement("div");
      titleSection.style.cssText = "text-align: center; margin-bottom: 16px;";
      const titleSpan = document.createElement("span");
      titleSpan.style.cssText = "font-size: 24px; font-weight: 700; color: #5c9eff;";
      titleSpan.textContent = "Neptun PowerUp!";
      titleSection.appendChild(titleSpan);
      const versionDiv = document.createElement("div");
      versionDiv.style.cssText = "font-size: 12px; color: #9e9e9e; margin-top: 4px;";
      versionDiv.textContent = `v${version}`;
      titleSection.appendChild(versionDiv);
      dialog.appendChild(titleSection);
      const ackParagraph = document.createElement("div");
      ackParagraph.style.cssText = "font-size: 13px; color: #bbb; margin-bottom: 14px;";
      ackParagraph.textContent = "Before using NPU, please confirm that you understand what it does:";
      dialog.appendChild(ackParagraph);
      const bulletList = document.createElement("ul");
      bulletList.style.cssText = "font-size: 12px; color: #ccc; line-height: 1.8; padding-left: 18px; margin: 0 0 16px 0;";
      const bullets = [
        { bold: "Keeps the session alive", rest: " by refreshing active Neptun tokens" },
        { bold: "Clicks course controls", rest: " when you ask it to enroll saved selections" },
        { bold: "Clicks exam controls", rest: " when you ask it to enroll saved exam dates" },
        { bold: "May conflict with rules", rest: " at your university or faculty" }
      ];
      for (const bullet of bullets) {
        const li = document.createElement("li");
        const strong = document.createElement("strong");
        strong.style.cssText = "color: #ff9800;";
        strong.textContent = bullet.bold;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(bullet.rest));
        bulletList.appendChild(li);
      }
      dialog.appendChild(bulletList);
      const liabilityBox = document.createElement("div");
      liabilityBox.style.cssText = "font-size: 11px; color: #9e9e9e; margin-bottom: 18px; padding: 8px 10px; background: #1a1a2e; border-radius: 6px; border-left: 3px solid #ff9800;";
      liabilityBox.textContent = "Use it only if it is allowed for your account. You are responsible for the result.";
      dialog.appendChild(liabilityBox);
      const btnContainer = document.createElement("div");
      btnContainer.style.cssText = "display: flex; gap: 10px; justify-content: center;";
      const acceptBtn = document.createElement("button");
      acceptBtn.style.cssText = "padding: 8px 28px; background: #5c9eff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;";
      acceptBtn.textContent = "Accept";
      const declineBtn = document.createElement("button");
      declineBtn.style.cssText = "padding: 8px 28px; background: transparent; color: #9e9e9e; border: 1px solid #2a2a4a; border-radius: 6px; cursor: pointer; font-size: 13px;";
      declineBtn.textContent = "Decline";
      btnContainer.appendChild(acceptBtn);
      btnContainer.appendChild(declineBtn);
      dialog.appendChild(btnContainer);
      const footerNote = document.createElement("div");
      footerNote.style.cssText = "text-align: center; margin-top: 12px; font-size: 10px; color: #666;";
      footerNote.textContent = "You can show this prompt again from Settings.";
      dialog.appendChild(footerNote);
      overlay.appendChild(dialog);
      function cleanup(accepted) {
        overlay.remove();
        resolve(accepted);
      }
      try {
        document.body.appendChild(overlay);
      } catch {
        document.addEventListener("DOMContentLoaded", () => {
          if (!overlay.parentNode) document.body.appendChild(overlay);
        });
      }
      acceptBtn.addEventListener("click", () => cleanup(true));
      declineBtn.addEventListener("click", () => cleanup(false));
    });
  }
  async function main() {
    const logger = createLogger("core");
    if (!isLikelyNeptunPortal()) {
      return;
    }
    logger.info("Neptun PowerUp! v3 starting...");
    let gmStorage;
    try {
      const testGm = typeof GM !== "undefined" && GM.getValue;
      if (!testGm) throw new Error("GM API not available");
      gmStorage = {
        getValue: (key, defaultVal) => GM.getValue(key, defaultVal),
        setValue: (key, value) => GM.setValue(key, value)
      };
    } catch (err) {
      logger.warn("GM API unavailable, falling back to localStorage:", err);
      gmStorage = {
        getValue: async (key, defaultVal) => {
          try {
            return localStorage.getItem(`npu_${key}`) ?? defaultVal;
          } catch {
            return defaultVal;
          }
        },
        setValue: async (key, value) => {
          try {
            localStorage.setItem(`npu_${key}`, value);
          } catch (storageErr) {
            logger.error("localStorage.setItem failed:", storageErr);
          }
        }
      };
    }
    const domain = extractDomain(window.location.href);
    function buildContext() {
      return {
        url: window.location.href,
        domain,
        path: extractPath(window.location.href)
      };
    }
    logger.info(`domain: ${domain}, path: ${buildContext().path}`);
    const bus = createEventBus();
    const rushStorage = createStorageService(gmStorage, domain);
    const consentAccepted = await hasConsent(rushStorage);
    if (!consentAccepted) {
      const version = typeof GM !== "undefined" && GM.info?.script?.version ? GM.info.script.version : "dev";
      const accepted = await showConsentDialog(version);
      if (accepted) {
        await storeConsent(rushStorage);
        logger.info("consent accepted");
      } else {
        logger.info("consent declined — NPU will not activate");
        return;
      }
    }
    const courseRushInitial = await rushStorage.get("courseRushMode") ?? false;
    const examRushInitial = await rushStorage.get("examRushMode") ?? false;
    const oldPinkMode = await rushStorage.get("pinkMode");
    if (oldPinkMode === true) {
      const migrated = { enabled: true, color: "pink" };
      await rushStorage.setForDomain("themeSettings", migrated);
      await rushStorage.remove("pinkMode");
      logger.info("migrated pinkMode=true to themeSettings");
    }
    const savedThemeSettings = await rushStorage.getForDomain("themeSettings");
    const themeInitial = savedThemeSettings ?? { ...DEFAULT_THEME };
    logger.info(`rush mode initial state — course: ${courseRushInitial}, exam: ${examRushInitial}`);
    const statusPanel = createStatusPanel(
      bus,
      {
        onCourseRushChange: (on) => {
          rushStorage.set("courseRushMode", on).catch((err) => logger.error("failed to persist courseRushMode:", err));
          logger.info(`Course Rush Mode ${on ? "ON" : "OFF"}`);
          statusPanel.addMessage("info", `Course Rush ${on ? "on" : "off"}`);
        },
        onExamRushChange: (on) => {
          rushStorage.set("examRushMode", on).catch((err) => logger.error("failed to persist examRushMode:", err));
          logger.info(`Exam Rush Mode ${on ? "ON" : "OFF"}`);
          statusPanel.addMessage("info", `Exam Rush ${on ? "on" : "off"}`);
        },
        onConsentReset: () => {
          resetConsent(rushStorage).catch((err) => logger.error("failed to reset consent:", err));
          logger.info("Consent reset — dialog will appear on next load");
          statusPanel.addMessage("info", "Consent prompt will appear on the next page load.");
        },
        onThemeChange: (settings) => {
          rushStorage.setForDomain("themeSettings", settings).catch((err) => logger.error("failed to persist themeSettings:", err));
          logger.info(`Theme ${settings.enabled ? `enabled (${settings.color})` : "disabled"}`);
        }
      },
      {
        courseRush: courseRushInitial,
        examRush: examRushInitial
      },
      themeInitial
    );
    const stopInterceptor = setupInterceptor(bus, createLogger("interceptor"));
    const registry = createModuleRegistry(bus, gmStorage, statusPanel);
    registry.register(infiniteSessionModule);
    registry.register(courseStoreModule);
    registry.register(examSignupModule);
    registry.register(pinkModeModule);
    await registry.activateAll(buildContext());
    let lastPath = extractPath(window.location.href);
    observeRouteChanges(bus);
    bus.on("page:changed", async (payload) => {
      logger.info(`route changed: ${window.location.pathname}`);
      const previousPath = lastPath;
      lastPath = payload.path;
      const wasOnLogin = previousPath === "/login" || previousPath.endsWith("/login");
      const leftLogin = wasOnLogin && !payload.path.includes("/login");
      if (leftLogin) {
        const courseRush = statusPanel.getCourseRushMode();
        const examRush = statusPanel.getExamRushMode();
        if (courseRush) {
          logger.info("Course Rush Mode: redirecting to registration page after login");
          statusPanel.addMessage("info", "Opening course registration for Course Rush...");
          registry.disposeAll();
          const pathPrefix = window.location.pathname.split("/")[1] || "hallgatoi";
          window.location.href = `${window.location.origin}/${pathPrefix}/subjects/registration`;
          return;
        } else if (examRush) {
          logger.info("Exam Rush Mode: redirecting to exam overview after login");
          statusPanel.addMessage("info", "Opening exam overview for Exam Rush...");
          registry.disposeAll();
          const pathPrefix = window.location.pathname.split("/")[1] || "hallgatoi";
          window.location.href = `${window.location.origin}/${pathPrefix}/exams/overview/registration`;
          return;
        }
      }
      registry.disposeAll();
      await registry.activateAll(buildContext());
    });
    window.addEventListener("beforeunload", () => {
      try {
        stopInterceptor();
        registry.disposeAll();
        statusPanel.dispose();
      } catch (err) {
        logger.error("error during beforeunload cleanup:", err);
      }
    });
    logger.info("startup complete");
  }
  main().catch((error) => {
    console.error("[NPU:core] fatal startup error:", error);
  });

})();