// ==UserScript==
// @name         Neptun PowerUp! Userscript
// @namespace    https://github.com/surilevi/neptun-powerup-userscript
// @version      3.5.1
// @author       surilevi
// @description  Neptun PowerUp! userscript for course and exam workflows
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neptun.net
// @homepage     https://github.com/surilevi/neptun-powerup-userscript#readme
// @homepageURL  https://github.com/surilevi/neptun-powerup-userscript#readme
// @source       https://github.com/surilevi/neptun-powerup-userscript.git
// @supportURL   https://github.com/surilevi/neptun-powerup-userscript/issues
// @downloadURL  https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js
// @updateURL    https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js
// @match        https://*/hallgato*/*
// @match        https://*/ujhallgato/*
// @grant        GM.getValue
// @grant        GM.info
// @grant        GM.setValue
// @noframes
// ==/UserScript==

(function() {
	"use strict";
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
			} else handlers.get(event)?.delete(handler);
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
		return {
			on,
			off,
			emit
		};
	}
	var DEBUG_STORAGE_KEY = "npu_debug";
	var DEBUG_MESSAGE_TAGS = [
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
			if (DEBUG_MESSAGE_TAGS.some((tag) => arg.includes(tag))) return true;
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
	var writeQueue = Promise.resolve();
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
				throw err;
			}
		}
		function updateAll(mutator) {
			writeQueue = writeQueue.catch(() => void 0).then(async () => {
				const data = await loadAll();
				mutator(data);
				await saveAll(data);
			});
			return writeQueue;
		}
		return {
			async get(key) {
				return (await loadAll())[key];
			},
			async set(key, value) {
				await updateAll((data) => {
					data[key] = value;
				});
			},
			async remove(key) {
				await updateAll((data) => {
					delete data[key];
				});
			},
			async getForDomain(key) {
				return ((await loadAll())[`domain:${domain}`] ?? {})[key];
			},
			async setForDomain(key, value) {
				await updateAll((data) => {
					const domainData = data[`domain:${domain}`] ?? {};
					domainData[key] = value;
					data[`domain:${domain}`] = domainData;
				});
			},
			async setForDomainValues(values) {
				await updateAll((data) => {
					const domainData = data[`domain:${domain}`] ?? {};
					Object.assign(domainData, values);
					data[`domain:${domain}`] = domainData;
				});
			}
		};
	}
	function createModuleRegistry(bus, gmStorage, statusPanel) {
		const modules = [];
		const activated = new Set();
		let isActivating = false;
		const panel = statusPanel ?? {
			setSessionStatus: () => {},
			addMessage: () => {},
			setVersionWarning: () => {},
			setModuleContent: () => {},
			setModuleContentElement: () => {},
			expand: () => {},
			collapse: () => {},
			toggle: () => {},
			isExpanded: () => false,
			getCourseRushMode: () => false,
			setCourseRushMode: () => Promise.resolve(),
			getExamRushMode: () => false,
			setExamRushMode: () => Promise.resolve(),
			getThemeSettings: () => ({
				enabled: false,
				color: "pink"
			}),
			setThemeSettings: () => {},
			onThemeSettingsChange: () => () => {},
			dispose: () => {}
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
					const api = {
						bus,
						storage: createStorageService(gmStorage ?? {
							getValue: async () => void 0,
							setValue: async () => {}
						}, context.domain),
						logger,
						statusPanel: panel
					};
					try {
						await mod.initialize(api);
						activated.add(mod.id);
						logger.info("activated");
					} catch (error) {
						bus.emit("module:error", {
							moduleId: mod.id,
							error
						});
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
					createLogger(mod.id).error("failed to dispose:", error);
				}
			}
		}
		return {
			register,
			activateAll,
			disposeAll
		};
	}
	var STYLE_ID = "npu-theme-mode";
	var THEME_PRESETS = [
		{
			name: "Pink",
			key: "pink",
			primary: "#e91e63",
			dark: "#880e4f",
			light: "#f48fb1",
			bgTint: "#fdf2f6",
			link: "#c2185b",
			tableHeader: "#ec407a",
			footerText: "#fce4ec"
		},
		{
			name: "Purple",
			key: "purple",
			primary: "#9c27b0",
			dark: "#4a148c",
			light: "#ce93d8",
			bgTint: "#f3e5f5",
			link: "#7b1fa2",
			tableHeader: "#ab47bc",
			footerText: "#e1bee7"
		},
		{
			name: "Teal",
			key: "teal",
			primary: "#009688",
			dark: "#004d40",
			light: "#80cbc4",
			bgTint: "#e0f2f1",
			link: "#00796b",
			tableHeader: "#26a69a",
			footerText: "#b2dfdb"
		},
		{
			name: "Orange",
			key: "orange",
			primary: "#ff5722",
			dark: "#bf360c",
			light: "#ffab91",
			bgTint: "#fbe9e7",
			link: "#e64a19",
			tableHeader: "#ff7043",
			footerText: "#ffccbc"
		},
		{
			name: "Red",
			key: "red",
			primary: "#f44336",
			dark: "#b71c1c",
			light: "#ef9a9a",
			bgTint: "#ffebee",
			link: "#d32f2f",
			tableHeader: "#ef5350",
			footerText: "#ffcdd2"
		}
	];
	var DEFAULT_THEME = {
		enabled: false,
		color: "pink"
	};
	var THEME_CSS = `
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
	var api$4 = null;
	var styleElement = null;
	var unsubTheme = null;
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
	var pinkModeModule = {
		id: "pink-mode",
		name: "Theme",
		description: "Color accent theme for Neptun",
		shouldActivate(_context) {
			return true;
		},
		initialize(moduleApi) {
			api$4 = moduleApi;
			const settings = api$4.statusPanel.getThemeSettings();
			if (settings.enabled) {
				const preset = getPreset(settings.color);
				inject(preset);
				api$4.logger.info(`theme activated: ${preset.name}`);
			}
			unsubTheme = api$4.statusPanel.onThemeSettingsChange((newSettings) => {
				if (newSettings.enabled) {
					const preset = getPreset(newSettings.color);
					inject(preset);
					api$4?.logger.info(`theme changed to ${preset.name}`);
				} else {
					remove();
					api$4?.logger.info("theme deactivated");
				}
			});
		},
		dispose() {
			unsubTheme?.();
			unsubTheme = null;
			remove();
			api$4 = null;
		}
	};
	function getScriptVersion() {
		try {
			if (typeof GM !== "undefined" && GM.info?.script?.version) return GM.info.script.version;
		} catch {}
		return "dev";
	}
	var MAX_MESSAGES = 5;
	var COLORS = {
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
	function pad2$1(n) {
		return n < 10 ? `0${n}` : `${n}`;
	}
	function formatTime(date) {
		return `${pad2$1(date.getHours())}:${pad2$1(date.getMinutes())}:${pad2$1(date.getSeconds())}`;
	}
	function formatCountdown(ms) {
		if (ms <= 0) return "0s";
		const totalSec = Math.ceil(ms / 1e3);
		const min = Math.floor(totalSec / 60);
		const sec = totalSec % 60;
		return min > 0 ? `${min}m ${pad2$1(sec)}s` : `${sec}s`;
	}
	function levelIcon(level) {
		switch (level) {
			case "info": return "✓";
			case "warn": return "⚠";
			case "error": return "✕";
		}
	}
	function levelColor(level) {
		switch (level) {
			case "info": return COLORS.green;
			case "warn": return COLORS.yellow;
			case "error": return COLORS.red;
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
		let versionWarningSection = null;
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
			const versionSpan = document.createElement("span");
			versionSpan.style.cssText = `
      font-size: 10px;
      font-weight: 600;
      color: ${COLORS.textMuted};
      margin-right: 8px;
      flex-shrink: 0;
    `;
			versionSpan.textContent = `v${getScriptVersion()}`;
			versionSpan.title = "Installed Neptun PowerUp! userscript version";
			header.appendChild(versionSpan);
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
			sessionLine.title = "Session keep-alive is best-effort. Neptun may still force logout during course or exam registration rushes.";
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
			courseLabel.title = "After login, enroll exact courses already added to Neptun timetable planner. Locally saved courses are the fallback when the planner is empty. Disable Neptun’s registration confirmation popup first.";
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
			examLabel.title = "After login, open exams and enroll saved dates. Session keep-alive is not guaranteed during registration rushes.";
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
			versionWarningSection = document.createElement("div");
			versionWarningSection.id = "npu-version-warning";
			versionWarningSection.style.cssText = `
      display: none;
      padding: 8px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
    `;
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
			normalContent.appendChild(versionWarningSection);
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
					if (root && !root.parentNode) document.body.appendChild(root);
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
			if (rushCallbacks?.onExportSavedChoices || rushCallbacks?.onImportSavedChoices) {
				const dataHeader = document.createElement("div");
				dataHeader.style.cssText = `color: ${COLORS.accent}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 16px; margin-bottom: 8px; padding-top: 12px; border-top: 1px solid ${COLORS.border};`;
				dataHeader.textContent = "Saved choices";
				container.appendChild(dataHeader);
				const dataNote = document.createElement("div");
				dataNote.style.cssText = `font-size: 10px; color: ${COLORS.textMuted}; margin-bottom: 8px;`;
				dataNote.textContent = "Back up or replace the saved course and exam choices for this Neptun domain.";
				container.appendChild(dataNote);
				const dataActions = document.createElement("div");
				dataActions.style.cssText = "display: flex; gap: 6px;";
				container.appendChild(dataActions);
				const dataStatus = document.createElement("div");
				dataStatus.id = "npu-saved-choices-status";
				dataStatus.setAttribute("aria-live", "polite");
				dataStatus.style.cssText = `font-size: 10px; color: ${COLORS.textMuted}; margin-top: 6px; min-height: 14px;`;
				container.appendChild(dataStatus);
				async function runDataAction(button, pendingLabel, action) {
					const originalLabel = button.textContent ?? "";
					const actionButtons = Array.from(dataActions.querySelectorAll("button"));
					for (const actionButton of actionButtons) {
						actionButton.disabled = true;
						actionButton.style.opacity = "0.7";
					}
					button.textContent = pendingLabel;
					dataStatus.textContent = "";
					try {
						const message = await action();
						if (message) {
							dataStatus.style.color = COLORS.green;
							dataStatus.textContent = message;
						}
					} catch (err) {
						dataStatus.style.color = COLORS.red;
						dataStatus.textContent = err instanceof Error ? err.message : String(err);
					} finally {
						for (const actionButton of actionButtons) {
							actionButton.disabled = false;
							actionButton.style.opacity = "1";
						}
						button.textContent = originalLabel;
					}
				}
				const dataButtonStyle = `flex: 1; padding: 5px 8px; background: transparent; color: ${COLORS.text}; border: 1px solid ${COLORS.border}; border-radius: 4px; cursor: pointer; font-size: 11px;`;
				if (rushCallbacks.onExportSavedChoices) {
					const exportBtn = document.createElement("button");
					exportBtn.id = "npu-export-saved-choices";
					exportBtn.type = "button";
					exportBtn.style.cssText = dataButtonStyle;
					exportBtn.textContent = "Export JSON";
					exportBtn.addEventListener("click", () => {
						runDataAction(exportBtn, "Exporting...", rushCallbacks.onExportSavedChoices).catch(() => void 0);
					});
					dataActions.appendChild(exportBtn);
				}
				if (rushCallbacks.onImportSavedChoices) {
					const importBtn = document.createElement("button");
					importBtn.id = "npu-import-saved-choices";
					importBtn.type = "button";
					importBtn.style.cssText = dataButtonStyle;
					importBtn.textContent = "Import JSON";
					importBtn.addEventListener("click", () => {
						runDataAction(importBtn, "Importing...", rushCallbacks.onImportSavedChoices).catch(() => void 0);
					});
					dataActions.appendChild(importBtn);
				}
			}
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
			if (titleSpanRef) titleSpanRef.textContent = settingsVisible ? "⚙ Settings" : "Neptun PowerUp!";
		}
		function dotColor() {
			if (isFlashing) return COLORS.red;
			switch (sessionState) {
				case "active": return COLORS.green;
				case "expiring": return COLORS.yellow;
				case "expired": return COLORS.red;
				case "refreshing": return COLORS.yellow;
			}
		}
		function updateDots() {
			const color = dotColor();
			if (badgeDot) badgeDot.style.background = color;
			if (headerDot) headerDot.style.background = color;
			if (badge) {
				if (courseRushOn || examRushOn) badge.style.animation = "npu-pulse 2s ease-in-out infinite";
				else badge.style.animation = "";
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
		function setVersionWarning(warning) {
			if (!versionWarningSection) return;
			while (versionWarningSection.firstChild) versionWarningSection.removeChild(versionWarningSection.firstChild);
			if (!warning) {
				versionWarningSection.style.display = "none";
				return;
			}
			versionWarningSection.style.display = "block";
			const title = document.createElement("div");
			title.style.cssText = `font-size: 12px; font-weight: 700; color: ${COLORS.yellow}; margin-bottom: 4px;`;
			title.textContent = warning.title;
			versionWarningSection.appendChild(title);
			const detail = document.createElement("div");
			detail.style.cssText = `font-size: 11px; color: ${COLORS.text}; margin-bottom: 6px;`;
			detail.textContent = warning.detail;
			versionWarningSection.appendChild(detail);
			const versions = document.createElement("div");
			versions.style.cssText = `font-size: 10px; color: ${COLORS.textMuted}; line-height: 1.4; margin-bottom: 8px; word-break: break-word;`;
			versions.textContent = warning.previous ? `Previous: ${warning.previous} | Current: ${warning.current}` : `Current: ${warning.current}`;
			versionWarningSection.appendChild(versions);
			const action = document.createElement("button");
			action.type = "button";
			action.style.cssText = `padding: 5px 10px; background: ${COLORS.yellow}; color: #1a1a2e; border: 0; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;`;
			action.textContent = warning.actionLabel;
			action.addEventListener("click", async () => {
				action.setAttribute("disabled", "true");
				action.style.opacity = "0.7";
				await warning.onAction();
			});
			versionWarningSection.appendChild(action);
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
			if (remainingMs !== void 0) sessionRemainingMs = remainingMs;
			updateDots();
			renderSessionLine();
			if ((state === "active" || state === "expiring") && sessionRemainingMs > 0) startCountdown();
		}
		function addMessage(level, text) {
			const entry = {
				level,
				text,
				time: formatTime(new Date())
			};
			messages.unshift(entry);
			if (messages.length > MAX_MESSAGES) messages.pop();
			renderMessages();
			if (level === "error" || level === "warn") flashBadge();
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
		async function setCourseRushModeValue(on) {
			if (courseRushOn === on) return;
			courseRushOn = on;
			if (courseRushToggle) courseRushToggle.checked = on;
			updateDots();
			await rushCallbacks?.onCourseRushChange(on);
		}
		function getExamRushMode() {
			return examRushOn;
		}
		async function setExamRushModeValue(on) {
			if (examRushOn === on) return;
			examRushOn = on;
			if (examRushToggle) examRushToggle.checked = on;
			updateDots();
			await rushCallbacks?.onExamRushChange(on);
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
			versionWarningSection = null;
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
			unsubs.push(bus.on("token:acquired", (payload) => {
				const refreshRemaining = payload.refreshExpiresAt ? Math.max(0, payload.refreshExpiresAt - Date.now()) : 0;
				if (refreshRemaining > 0) setSessionStatus("active", refreshRemaining);
				else setSessionStatus("active", 0);
			}));
			unsubs.push(bus.on("token:expiring", (payload) => {
				setSessionStatus("expiring", payload.remainingMs);
			}));
			unsubs.push(bus.on("token:expired", () => {
				setSessionStatus("expired");
			}));
			unsubs.push(bus.on("page:changed", (payload) => {
				if (payload.path.includes("/login") || payload.path.includes("/subjects/registration")) expand();
				if (moduleSection) while (moduleSection.firstChild) moduleSection.removeChild(moduleSection.firstChild);
			}));
			unsubs.push(bus.on("module:error", (payload) => {
				const errMsg = payload.error instanceof Error ? payload.error.message : String(payload.error);
				addMessage("error", `[${payload.moduleId}] ${errMsg}`);
			}));
		}
		function autoExpandOnLoad() {
			const path = window.location.pathname;
			if (path.includes("/login") || path.includes("/subjects/registration")) expand();
		}
		build();
		subscribe();
		autoExpandOnLoad();
		return {
			setSessionStatus,
			addMessage,
			setVersionWarning,
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
	var KNOWN_ENDPOINTS = {
		authenticate: "Account/Authenticate",
		getNewTokens: "Account/GetNewTokens",
		outerLogin: "Account/OuterLogin",
		environmentData: "General/EnvironmentData",
		unreadMessages: "Message/GetUnreadedMessagesCount",
		upcomingEvents: "Dashboard/GetUpcomingEvents",
		schedulableSubjects: "SubjectApplication/SchedulableSubjects",
		subjectCourses: "SubjectApplication/GetSubjectsCourses",
		subjectSignin: "SubjectApplication/SubjectSignin"
	};
	var SESSION_STORAGE_KEYS = {
		accessToken: "access_token",
		accessTokenExpiration: "access_token_expiration_date",
		sessionExpiration: "session_expiration_date",
		refreshTokenExpiration: "refresh_token_expiration",
		loginType: "login_type",
		tabId: "tabId"
	};
	var SESSION_EXPIRATION_KEYS = [SESSION_STORAGE_KEYS.sessionExpiration, SESSION_STORAGE_KEYS.refreshTokenExpiration];
	function readSessionExpiresAt(storage) {
		for (const key of SESSION_EXPIRATION_KEYS) {
			let raw;
			try {
				raw = storage.getItem(key);
			} catch {
				return 0;
			}
			if (!raw) continue;
			const parsed = Date.parse(raw);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 0;
	}
	var POLL_INTERVAL_MS = 2e3;
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
				} else logger.warn("sessionStorage access failed (transient):", err);
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
			let refreshExpiration = null;
			let refreshExpiresAt = 0;
			for (const key of SESSION_EXPIRATION_KEYS) {
				const raw = readSessionStorage(key);
				if (!raw) continue;
				refreshExpiration = raw;
				const parsed = Date.parse(raw);
				if (Number.isFinite(parsed)) {
					refreshExpiresAt = parsed;
					break;
				}
				logger.warn(`[interceptor-debug] ${key} is not a valid date: "${raw}"`);
			}
			logger.info(`token detected, access expires at ${new Date(expiresAt).toISOString()}, refresh expires at ${refreshExpiresAt ? new Date(refreshExpiresAt).toISOString() : "unknown"}`);
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
			if (parts[parts.length - 3].startsWith("uni-")) return parts.slice(-3).join(".");
		}
		return last2;
	}
	var SUPPORTED_PORTAL_PREFIXES = [
		"/hallgatoi",
		"/hallgato_ng",
		"/hallgatoing",
		"/ujhallgato"
	];
	function safeLower(value) {
		return (value ?? "").toLowerCase();
	}
	function hasNeptunTitle(doc) {
		return /\bneptun(?:\s+web|\.net)?\b/i.test(doc.title);
	}
	function hasNeptunAssetMarker(doc) {
		return Array.from(doc.querySelectorAll("script[src], link[href], img[src], meta[content]")).some((node) => {
			return [
				"src" in node ? node.getAttribute("src") : null,
				"href" in node ? node.getAttribute("href") : null,
				node.getAttribute("content")
			].some((value) => {
				const marker = safeLower(value);
				return marker.includes("neptun") || marker.includes("/hallgato");
			});
		});
	}
	function hasNeptunAppShell(doc) {
		return Boolean(doc.querySelector([
			"app-root",
			"app-login",
			"app-footer",
			"app-header",
			"[data-neptun]",
			"[ng-version]"
		].join(",")));
	}
	function isSupportedPortalPath(pathname) {
		const path = safeLower(pathname);
		return SUPPORTED_PORTAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
	}
	function hasNeptunFingerprint(doc = document) {
		if (hasNeptunTitle(doc)) return true;
		return hasNeptunAppShell(doc) && hasNeptunAssetMarker(doc);
	}
	function hasNeptunSessionStorage(storage = sessionStorage) {
		try {
			return [
				"access_token",
				"access_token_expiration_date",
				"session_expiration_date",
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
		return new URL(url).pathname;
	}
	KNOWN_ENDPOINTS.authenticate, KNOWN_ENDPOINTS.getNewTokens;
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
	function getStoredRefreshExpiresAt() {
		try {
			return readSessionExpiresAt(sessionStorage);
		} catch {
			return 0;
		}
	}
	function readStoredSessionExpirationRaw() {
		for (const key of SESSION_EXPIRATION_KEYS) try {
			const raw = sessionStorage.getItem(key);
			if (raw) return raw;
		} catch {
			return null;
		}
		return null;
	}
	function formatRemaining(ms) {
		return Number.isFinite(ms) && ms >= 0 ? `${Math.round(ms / 1e3)}s` : "unknown";
	}
	var ACCESS_REFRESH_BUFFER_MS = 3e4;
	var SESSION_REFRESH_BUFFER_MS = 15e4;
	var WATCHDOG_INTERVAL_MS = 15e3;
	var ACTIVITY_PULSE_INTERVAL_MS = 24e4;
	var NATIVE_REFRESH_SETTLE_MS = 6e3;
	var FALLBACK_RETRY_MS = 1e4;
	var watchdogTimer = null;
	var activityPulseTimer = null;
	var fallbackRetryTimer = null;
	var nativeRefreshSettleTimer = null;
	var keepAliveInFlight = false;
	var currentExpiresAt = 0;
	var currentRefreshExpiresAt = 0;
	var sessionExpiredEmitted = false;
	var api$3 = null;
	var unsubscribe = null;
	var visibilityHandler = null;
	var sessionModalObserver = null;
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
			const refreshExpiration = readStoredSessionExpirationRaw();
			const refreshExpiresAt = readSessionExpiresAt(sessionStorage);
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
	function getRefreshExpiresAt() {
		const storedRefreshExpiresAt = getStoredRefreshExpiresAt();
		if (storedRefreshExpiresAt > 0) currentRefreshExpiresAt = storedRefreshExpiresAt;
		return currentRefreshExpiresAt;
	}
	function getSessionRemaining() {
		const refreshExpiresAt = getRefreshExpiresAt();
		return refreshExpiresAt > 0 ? refreshExpiresAt - Date.now() : -1;
	}
	function getRefreshDecision(now = Date.now()) {
		const accessRemainingMs = currentExpiresAt > 0 ? currentExpiresAt - now : -1;
		const refreshExpiresAt = getRefreshExpiresAt();
		const sessionRemainingMs = refreshExpiresAt > 0 ? refreshExpiresAt - now : -1;
		if (sessionRemainingMs >= 0) {
			if (sessionRemainingMs <= SESSION_REFRESH_BUFFER_MS) return {
				shouldRefresh: true,
				reason: "session-timeout",
				accessRemainingMs,
				sessionRemainingMs
			};
			return {
				shouldRefresh: false,
				reason: null,
				accessRemainingMs,
				sessionRemainingMs
			};
		}
		if (currentExpiresAt > 0 && accessRemainingMs <= ACCESS_REFRESH_BUFFER_MS) return {
			shouldRefresh: true,
			reason: "access-token",
			accessRemainingMs,
			sessionRemainingMs
		};
		return {
			shouldRefresh: false,
			reason: null,
			accessRemainingMs,
			sessionRemainingMs
		};
	}
	function restoreSessionStatusAfterRefreshFailure() {
		if (!api$3) return;
		const sessionRemaining = getSessionRemaining();
		if (sessionRemaining > 0) {
			api$3.statusPanel.setSessionStatus(sessionRemaining <= SESSION_REFRESH_BUFFER_MS ? "expiring" : "active", sessionRemaining);
			return;
		}
		const accessRemaining = currentExpiresAt - Date.now();
		if (currentRefreshExpiresAt <= 0 && accessRemaining > 0) {
			api$3.statusPanel.setSessionStatus(accessRemaining <= ACCESS_REFRESH_BUFFER_MS ? "expiring" : "active", accessRemaining);
			return;
		}
		emitTokenExpired();
	}
	function emitTokenExpired() {
		if (sessionExpiredEmitted) return;
		sessionExpiredEmitted = true;
		api$3?.bus.emit("token:expired", {});
	}
	function getStoredAccessToken() {
		try {
			return sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken);
		} catch {
			return null;
		}
	}
	function hasStoredAccessToken() {
		if (getStoredAccessToken()) return true;
		if (!sessionExpiredEmitted) api$3?.logger.warn("[session-debug] access token missing from sessionStorage, session lost");
		emitTokenExpired();
		return false;
	}
	function dispatchNeptunActivityEvent() {
		const target = document.querySelector(".footer__version") ?? document.querySelector("app-footer") ?? document.body ?? document.documentElement ?? document;
		const activityEvent = typeof window.MouseEvent === "function" ? new window.MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true
		}) : new window.Event("mousedown", {
			bubbles: true,
			cancelable: true
		});
		target.dispatchEvent(activityEvent);
	}
	function requestNeptunNativeRefresh() {
		if (document.visibilityState === "visible") try {
			const visibilityEvent = typeof window.Event === "function" ? new window.Event("visibilitychange") : new Event("visibilitychange");
			document.dispatchEvent(visibilityEvent);
		} catch (err) {
			api$3?.logger.warn("[session-debug] failed to dispatch Neptun visibility refresh:", err);
		}
		try {
			dispatchNeptunActivityEvent();
		} catch (err) {
			api$3?.logger.warn("[session-debug] failed to dispatch Neptun activity refresh:", err);
		}
	}
	function stopWatchdog() {
		if (watchdogTimer !== null) {
			clearInterval(watchdogTimer);
			watchdogTimer = null;
		}
		if (activityPulseTimer !== null) {
			clearInterval(activityPulseTimer);
			activityPulseTimer = null;
		}
		if (fallbackRetryTimer !== null) {
			clearTimeout(fallbackRetryTimer);
			fallbackRetryTimer = null;
		}
		if (nativeRefreshSettleTimer !== null) {
			clearTimeout(nativeRefreshSettleTimer);
			nativeRefreshSettleTimer = null;
		}
	}
	function startWatchdog() {
		if (watchdogTimer !== null) return;
		api$3?.logger.info("[session-debug] startWatchdog: starting 15s interval");
		watchdogTimer = setInterval(() => {
			if (!currentExpiresAt || !api$3) return;
			if (keepAliveInFlight) return;
			if (!hasStoredAccessToken()) return;
			const decision = getRefreshDecision();
			api$3.logger.info(`[session-debug] watchdog tick: access=${formatRemaining(decision.accessRemainingMs)}, session=${formatRemaining(decision.sessionRemainingMs)}, accessBuffer=30s, sessionBuffer=150s`);
			if (currentRefreshExpiresAt > 0 && decision.sessionRemainingMs <= 0) {
				api$3.logger.warn("[session-debug] refresh token expired, session lost");
				emitTokenExpired();
				return;
			}
			if (decision.shouldRefresh && decision.reason) {
				api$3.logger.info(`[session-debug] watchdog tick: ${decision.reason} is inside refresh buffer`);
				triggerKeepAlive(decision.reason);
			} else api$3.logger.info("[session-debug] watchdog tick: token still fresh, skipping refresh");
		}, WATCHDOG_INTERVAL_MS);
	}
	function startActivityPulse() {
		if (activityPulseTimer !== null) return;
		api$3?.logger.info("[session-debug] startActivityPulse: starting 4m native activity interval");
		activityPulseTimer = setInterval(() => {
			if (!currentExpiresAt || !api$3) return;
			if (keepAliveInFlight) return;
			if (!hasStoredAccessToken()) return;
			const decision = getRefreshDecision();
			if (currentRefreshExpiresAt > 0 && decision.sessionRemainingMs <= 0) {
				api$3.logger.warn("[session-debug] activity pulse skipped because refresh token is expired");
				emitTokenExpired();
				return;
			}
			api$3.logger.info(`[session-debug] activity pulse: access=${formatRemaining(decision.accessRemainingMs)}, session=${formatRemaining(decision.sessionRemainingMs)}`);
			requestNeptunNativeRefresh();
		}, ACTIVITY_PULSE_INTERVAL_MS);
	}
	function warnRegistrationRushLimit() {
		const path = window.location.pathname.toLowerCase();
		if (!path.includes("/subjects/registration") && !path.includes("/exams/overview/registration")) return;
		api$3?.statusPanel.addMessage("warn", "Session keep-alive is best-effort; Neptun may still force logout during registration rushes.");
	}
	function triggerKeepAlive(reason = "access-token") {
		if (!api$3) return;
		if (keepAliveInFlight) return;
		const previousAccessToken = getStoredAccessToken();
		if (!previousAccessToken) {
			api$3.logger.warn("[session-debug] cannot refresh session: no access token in sessionStorage");
			emitTokenExpired();
			return;
		}
		const previousRefreshExpiresAt = getRefreshExpiresAt();
		keepAliveInFlight = true;
		const accessRemainingMs = Math.max(0, currentExpiresAt - Date.now());
		const sessionRemainingMs = getSessionRemaining();
		const visibleRemainingMs = sessionRemainingMs >= 0 ? sessionRemainingMs : accessRemainingMs;
		api$3.bus.emit("token:expiring", {
			expiresAt: currentRefreshExpiresAt || currentExpiresAt,
			remainingMs: visibleRemainingMs
		});
		api$3.statusPanel.setSessionStatus("refreshing");
		api$3.logger.info(`[session-debug] requesting native Neptun refresh (${reason}) with access=${formatRemaining(accessRemainingMs)}, session=${formatRemaining(sessionRemainingMs)}`);
		requestNeptunNativeRefresh();
		nativeRefreshSettleTimer = setTimeout(() => {
			nativeRefreshSettleTimer = null;
			const payload = getExistingTokenPayload();
			const latestAccessToken = getStoredAccessToken();
			const latestRefreshExpiresAt = getRefreshExpiresAt();
			if (payload && (latestAccessToken !== previousAccessToken || latestRefreshExpiresAt > previousRefreshExpiresAt)) {
				keepAliveInFlight = false;
				api$3?.logger.info("[session-debug] native Neptun refresh succeeded");
				api$3?.bus.emit("token:acquired", payload);
				return;
			}
			keepAliveInFlight = false;
			if (!api$3) return;
			api$3.logger.warn("[session-debug] native Neptun refresh did not update stored tokens");
			const sessionRemaining = getSessionRemaining();
			const accessRemaining = currentExpiresAt - Date.now();
			const retryWindowRemaining = sessionRemaining > 0 ? sessionRemaining : accessRemaining;
			if (currentRefreshExpiresAt > 0 && sessionRemaining <= 0) {
				api$3.logger.warn("refresh token expired and native session refresh failed, session lost");
				emitTokenExpired();
			} else if (currentRefreshExpiresAt <= 0 && accessRemaining <= 0) {
				api$3.logger.warn("token has expired and native session refresh failed, session lost");
				emitTokenExpired();
			} else {
				restoreSessionStatusAfterRefreshFailure();
				if (retryWindowRemaining > 15e3) {
					api$3.logger.info("session still valid, scheduling native refresh retry");
					if (fallbackRetryTimer !== null) clearTimeout(fallbackRetryTimer);
					fallbackRetryTimer = setTimeout(() => {
						fallbackRetryTimer = null;
						triggerKeepAlive(reason);
					}, FALLBACK_RETRY_MS);
				} else api$3.logger.info(`refresh window has only ${Math.round(retryWindowRemaining / 1e3)}s left, watchdog will handle`);
			}
		}, NATIVE_REFRESH_SETTLE_MS);
	}
	function onTokenAcquired(payload) {
		if (!Number.isFinite(payload.expiresAt)) {
			api$3?.logger.warn(`token:acquired expiresAt is not finite (${payload.expiresAt}), ignoring`);
			return;
		}
		currentExpiresAt = payload.expiresAt;
		currentRefreshExpiresAt = payload.refreshExpiresAt || getStoredRefreshExpiresAt() || currentRefreshExpiresAt;
		sessionExpiredEmitted = false;
		api$3?.logger.info(`[session-debug] token acquired: access expires in ${Math.round((payload.expiresAt - Date.now()) / 1e3)}s, refresh expires in ${payload.refreshExpiresAt ? Math.round((payload.refreshExpiresAt - Date.now()) / 1e3) : "unknown"}s`);
		if (fallbackRetryTimer !== null) {
			clearTimeout(fallbackRetryTimer);
			fallbackRetryTimer = null;
			api$3?.logger.info("[session-debug] cleared pending fallback retry after token update");
		}
		if (keepAliveInFlight && nativeRefreshSettleTimer !== null) {
			clearTimeout(nativeRefreshSettleTimer);
			nativeRefreshSettleTimer = null;
			keepAliveInFlight = false;
			api$3?.logger.info("[session-debug] native refresh observed by token watcher");
		}
		startWatchdog();
		startActivityPulse();
	}
	function hydrateFromSessionStorage() {
		const payload = getExistingTokenPayload();
		if (!payload) {
			api$3?.logger.info("[session-debug] initialize: no existing token found in sessionStorage");
			return;
		}
		api$3?.logger.info(`[session-debug] initialize: recovered existing token with ${Math.round((payload.expiresAt - Date.now()) / 1e3)}s remaining`);
		onTokenAcquired(payload);
	}
	function onVisibilityChange() {
		try {
			api$3?.logger.info(`[session-debug] onVisibilityChange: state="${document.visibilityState}"`);
			if (document.visibilityState !== "visible") return;
			if (!currentExpiresAt || !api$3) return;
			if (keepAliveInFlight) return;
			const decision = getRefreshDecision();
			api$3.logger.info(`[session-debug] onVisibilityChange: tab visible, access=${formatRemaining(decision.accessRemainingMs)}, session=${formatRemaining(decision.sessionRemainingMs)}, accessBuffer=30s, sessionBuffer=150s`);
			if (decision.shouldRefresh && decision.reason) {
				api$3.logger.info(`[session-debug] onVisibilityChange: ${decision.reason} near expiry, triggering keep-alive immediately`);
				triggerKeepAlive(decision.reason);
			}
		} catch (err) {
			api$3?.logger.error("error in visibility change handler:", err);
		}
	}
	function suppressSessionTimeoutModals() {
		sessionModalObserver?.disconnect();
		sessionModalObserver = new MutationObserver(() => {
			const overlayButtons = document.querySelectorAll(".cdk-overlay-container button, .mat-mdc-dialog-container button");
			for (const btn of Array.from(overlayButtons)) {
				const rawText = (btn.textContent ?? "").trim();
				const text = normalizeMatchText(rawText);
				const dialogText = normalizeMatchText(btn.closest(".cdk-overlay-pane, .mat-mdc-dialog-container")?.textContent ?? "");
				const isSessionDialog = (dialogText.includes("session") || dialogText.includes("munkamenet")) && (dialogText.includes("lejar") || dialogText.includes("expir") || dialogText.includes("timeout") || dialogText.includes("idotullepes") || dialogText.includes("kijelentkezes") || /\d+\s*(perc|sec|mp|masodperc)/.test(dialogText));
				const isExtendButton = text === "ok" || text === "igen" || text.includes("extend") || text.includes("meghosszabbit") || text.includes("folytat") || text.includes("marad");
				if (isSessionDialog && isExtendButton) {
					api$3?.logger.info(`[session-debug] suppressing session timeout modal, clicking: ${rawText}`);
					api$3?.statusPanel.addMessage("info", "Session timeout dialog dismissed");
					btn.click();
					return;
				}
			}
		});
		sessionModalObserver.observe(document.body, {
			childList: true,
			subtree: true
		});
	}
	var infiniteSessionModule = {
		id: "infinite-session",
		name: "Infinite Session",
		description: "Best-effort session keep-alive for normal use; Neptun can still force logout during registration rushes",
		shouldActivate(_context) {
			return true;
		},
		initialize(moduleApi) {
			api$3 = moduleApi;
			unsubscribe = api$3.bus.on("token:acquired", onTokenAcquired);
			visibilityHandler = onVisibilityChange;
			document.addEventListener("visibilitychange", visibilityHandler);
			suppressSessionTimeoutModals();
			hydrateFromSessionStorage();
			warnRegistrationRushLimit();
			api$3.logger.info("initialized, waiting for token from sessionStorage watcher");
		},
		dispose() {
			stopWatchdog();
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
			currentRefreshExpiresAt = 0;
			sessionExpiredEmitted = false;
			api$3 = null;
		}
	};
	var PLANNER_TIMING = Object.freeze({
		interactiveReadinessTimeoutMs: 3e4,
		rushReadinessTimeoutMs: 6e4,
		enrollmentRequestTimeoutMs: 3e4,
		enrollmentUiUpdateTimeoutMs: 5e3,
		listStabilityWindowMs: 500,
		domPollIntervalMs: 50,
		outcomePollIntervalMs: 100,
		controlActionCooldownMs: 1200,
		controlActionSettleMs: 3e3,
		controlActionMaxAttempts: 3,
		courseSelectionStabilityWindowMs: 400,
		emptySelectionGraceRatio: .1,
		emptySelectionGraceMinMs: 3e3,
		panelExpandTimeoutMs: 5e3,
		panelExpandFallbackMs: 800,
		domStateSettleMs: 150,
		enrollmentMaxAttempts: 3,
		enrollmentRetryBaseDelayMs: 700,
		notificationSettleMs: 1500,
		apiRequestTimeoutMs: 8e3,
		apiMaxAttempts: 3,
		apiRetryBaseDelayMs: 400,
		apiConfirmationDelayMs: 600
	});
	var WAIT_TIMEOUT_MS = PLANNER_TIMING.panelExpandTimeoutMs;
	var STORAGE_KEY$2 = "courseSelections";
	var api$2 = null;
	var isEnrolling = false;
	var routeUnsub = null;
	function getApi$1() {
		return api$2;
	}
	function setApi$1(value) {
		api$2 = value;
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
		const api = getApi$1();
		if (!api) return {};
		return await api.storage.getForDomain("courseSelections") ?? {};
	}
	async function saveSelections(selections) {
		const api = getApi$1();
		if (!api) return;
		await api.storage.setForDomain(STORAGE_KEY$2, selections);
	}
	async function clearSelections() {
		const api = getApi$1();
		if (!api) return;
		await api.storage.setForDomain(STORAGE_KEY$2, {});
	}
	async function removeSingleSubject(subjectCode) {
		const api = getApi$1();
		if (!api) return;
		const existing = await loadSelections();
		delete existing[subjectCode];
		await saveSelections(existing);
		api.logger.info(`removed saved courses for ${subjectCode}`);
		api.statusPanel.addMessage("info", `Removed saved courses for ${subjectCode}.`);
	}
	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	function waitForRequestComplete(urlPattern, timeoutMs, startedAfterMs = performance.now()) {
		return new Promise((resolve) => {
			let settled = false;
			let observer = null;
			let pollTimer = null;
			let timeoutTimer = null;
			function matches(entry) {
				if (!entry.name.includes(urlPattern)) return false;
				return typeof entry.startTime !== "number" || entry.startTime >= startedAfterMs;
			}
			function findMatchingEntry() {
				try {
					return performance.getEntriesByType("resource").find(matches) ?? null;
				} catch {
					return null;
				}
			}
			function settle(result) {
				if (settled) return;
				settled = true;
				observer?.disconnect();
				if (pollTimer) clearInterval(pollTimer);
				if (timeoutTimer) clearTimeout(timeoutTimer);
				resolve(result);
			}
			function settleFromEntry(entry) {
				const resourceEntry = entry;
				settle({
					completed: true,
					status: typeof resourceEntry.responseStatus === "number" ? resourceEntry.responseStatus : null
				});
			}
			function checkExistingEntries() {
				const match = findMatchingEntry();
				if (match) settleFromEntry(match);
			}
			function startPollingFallback() {
				if (pollTimer) return;
				pollTimer = setInterval(checkExistingEntries, 100);
			}
			const existingMatch = findMatchingEntry();
			if (existingMatch) {
				settleFromEntry(existingMatch);
				return;
			}
			try {
				observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) if (matches(entry)) {
						settleFromEntry(entry);
						return;
					}
				});
				try {
					observer.observe({
						type: "resource",
						buffered: true
					});
				} catch {
					try {
						observer.observe({
							type: "resource",
							buffered: false
						});
					} catch {
						observer.disconnect();
						observer = null;
						startPollingFallback();
					}
				}
			} catch {
				startPollingFallback();
			}
			timeoutTimer = setTimeout(() => settle({
				completed: false,
				status: null
			}), timeoutMs);
		});
	}
	var SUBJECT_CODE_CANDIDATE_RE = /\b[A-Z0-9][A-Z0-9-]{5,24}\b/g;
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
	var AUTO_SEARCH_TIMEOUT_MS = 2e4;
	var AUTO_SEARCH_POLL_MS = 250;
	var AUTO_SEARCH_STABLE_MS = 500;
	var SEARCH_RESULT_SETTLE_GRACE_MS = 2e3;
	function normalizeButtonText$1(text) {
		return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
	}
	var SEARCH_BUTTON_PATTERNS = [
		"targy keres",
		"search subject",
		"subject search"
	];
	var ENROLL_BUTTON_PATTERNS = [
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
	var COURSE_CODE_STOP_WORDS = [
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
		if (COURSE_CODE_STOP_WORDS.some((word) => normalized.startsWith(word))) return false;
		if (allowShortAlpha && /^[A-Z]{1,4}$/.test(normalized)) return true;
		return /[A-Z]/.test(normalized) && /[0-9_]/.test(normalized);
	}
	function extractCourseCodeFromText(text) {
		const trimmed = text.replace(/\s+/g, " ").trim();
		if (!trimmed) return null;
		const exact = normalizeCourseCode(trimmed);
		if (isCourseCodeToken(exact)) return exact;
		const underscored = /[A-Z0-9]{1,10}_[A-Z0-9]{1,10}/i.exec(trimmed);
		if (underscored && isCourseCodeToken(underscored[0])) return normalizeCourseCode(underscored[0]);
		const boundedTokens = trimmed.match(/\b[A-Z0-9][A-Z0-9_.-]{1,19}\b/gi) ?? [];
		for (const token of boundedTokens) if (isCourseCodeToken(token)) return normalizeCourseCode(token);
		return null;
	}
	function extractCourseCodeFromExactCandidate(text) {
		const trimmed = text.replace(/\s+/g, " ").trim();
		if (!trimmed) return null;
		const exact = normalizeCourseCode(trimmed);
		if (isCourseCodeToken(exact, { allowShortAlpha: true })) return exact;
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
			if (parent?.closest("button, mat-icon, .mat-icon, mat-chip, .mat-chip, .mat-mdc-chip")) continue;
			if (parent?.closest(".cdk-visually-hidden")) continue;
			candidates.push(text);
		}
		return candidates;
	}
	function isSearchButtonText(text) {
		const normalized = normalizeButtonText$1(text);
		return SEARCH_BUTTON_PATTERNS.some((pattern) => normalized.includes(pattern));
	}
	function isEnrollButtonText(text) {
		const normalized = normalizeButtonText$1(text);
		return ENROLL_BUTTON_PATTERNS.some((pattern) => normalized.includes(pattern));
	}
	function findSearchButton() {
		return Array.from(document.querySelectorAll("button")).find((btn) => isSearchButtonText(btn.textContent ?? "")) ?? null;
	}
	function isButtonInteractable$1(button) {
		if (!button.isConnected) return false;
		if (button.hasAttribute("disabled")) return false;
		const htmlButton = button;
		if (typeof htmlButton.disabled === "boolean" && htmlButton.disabled) return false;
		if (button.getAttribute("aria-disabled") === "true") return false;
		const style = window.getComputedStyle(button);
		if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
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
		if (!result) return {
			completed: false,
			status: null
		};
		return {
			completed: result.completed,
			status: result.status
		};
	}
	function extractSubjectCode(panel) {
		const api = getApi$1();
		const headerText = panel.querySelector("mat-expansion-panel-header")?.textContent ?? panel.querySelector(".mat-expansion-panel-header")?.textContent ?? panel.textContent ?? "";
		const code = extractSubjectCodeFromText(headerText);
		if (!code) api?.logger.info(`[dom-debug] extractSubjectCode: no code found, header starts with "${headerText.substring(0, 50)}"`);
		return code;
	}
	function extractCourseCode(courseItem) {
		const api = getApi$1();
		const text = (courseItem.textContent ?? "").trim();
		for (const selector of [
			".code-with-time .h6-unformatted",
			".h6-unformatted",
			".mat-mdc-checkbox .mdc-label",
			".mat-checkbox-label",
			"mat-checkbox label",
			".mat-mdc-checkbox label",
			"[data-course-code]",
			"[aria-label]",
			"[title]"
		]) {
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
						api?.logger.info(`[dom-debug] extractCourseCode: selector "${selector}" matched="${code}"`);
						return code;
					}
				}
			}
		}
		for (const candidate of getTextNodeCandidates(courseItem)) {
			const code = extractCourseCodeFromExactCandidate(candidate) ?? extractCourseCodeFromText(candidate);
			if (code) {
				api?.logger.info(`[dom-debug] extractCourseCode: text node matched="${code}"`);
				return code;
			}
		}
		const beforeType = /(?:^|[\s:])([A-Z0-9][A-Z0-9_.-]{1,19})(?=\s*T(?:i|í)pus)/i.exec(text);
		if (beforeType && isCourseCodeToken(beforeType[1])) {
			const code = normalizeCourseCode(beforeType[1]);
			api?.logger.info(`[dom-debug] extractCourseCode: before type label matched="${code}"`);
			return code;
		}
		const afterCourseCodeLabel = /Kurzus\s*k(?:o|ó)d\s*:?\s*([A-Z0-9][A-Z0-9_.-]{1,19})/i.exec(text);
		if (afterCourseCodeLabel && isCourseCodeToken(afterCourseCodeLabel[1])) {
			const code = normalizeCourseCode(afterCourseCodeLabel[1]);
			api?.logger.info(`[dom-debug] extractCourseCode: after course-code label matched="${code}"`);
			return code;
		}
		api?.logger.warn(`[dom-debug] extractCourseCode: no course code found, text starts with "${text.substring(0, 50)}"`);
		return null;
	}
	function getSubjectPanels() {
		return Array.from(document.querySelectorAll("mat-expansion-panel"));
	}
	function findSubjectPanel(subjectCode) {
		return getSubjectPanels().find((panel) => extractSubjectCode(panel) === subjectCode) ?? null;
	}
	async function autoSearchSubjects() {
		const api = getApi$1();
		const start = Date.now();
		const existingPanels = getSubjectPanels().length;
		api?.logger.info("[dom-debug] autoSearchSubjects: starting", {
			...getAutoSearchSnapshot(),
			timeoutMs: AUTO_SEARCH_TIMEOUT_MS
		});
		if (existingPanels > 0) {
			api?.logger.info(`[dom-debug] autoSearchSubjects: skipping, ${existingPanels} subjects already listed`);
			return {
				clickedSearchButton: false,
				searchStartedAtMs: null
			};
		}
		api?.logger.info("[dom-debug] autoSearchSubjects: no subjects listed, waiting for search button...");
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
				api?.logger.info("[dom-debug] autoSearchSubjects: DOM changed while waiting", {
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
			api?.logger.warn("[dom-debug] autoSearchSubjects: failed to observe DOM changes", err);
		}
		while (Date.now() - start < AUTO_SEARCH_TIMEOUT_MS) {
			const panels = getSubjectPanels().length;
			if (panels > 0) {
				observer?.disconnect();
				api?.logger.info("[dom-debug] autoSearchSubjects: subjects appeared before auto-click was needed", {
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
				const interactable = isButtonInteractable$1(searchBtn);
				const candidateState = JSON.stringify({
					...describeButton(searchBtn),
					interactable
				});
				if (candidateState !== lastCandidateState) {
					lastCandidateState = candidateState;
					api?.logger.info("[dom-debug] autoSearchSubjects: found search button candidate", {
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
						api?.logger.info("[dom-debug] autoSearchSubjects: auto-clicked search button", {
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
		api?.logger.warn(`[dom-debug] autoSearchSubjects: search button not found within ${AUTO_SEARCH_TIMEOUT_MS}ms`, {
			elapsedMs: Date.now() - start,
			mutations: mutationCount,
			snapshot: getAutoSearchSnapshot()
		});
		return {
			clickedSearchButton: false,
			searchStartedAtMs: null
		};
	}
	async function waitForSubjectListing({ timeoutMs = 6e4, searchStartedAtMs = performance.now(), allowAutoClick = false } = {}) {
		const api = getApi$1();
		const start = Date.now();
		const initialPanels = getSubjectPanels().length;
		if (initialPanels > 0) {
			api?.logger.info("[dom-debug] waitForSubjectListing: subjects already listed", { panels: initialPanels });
			return {
				state: "panels-loaded",
				panels: initialPanels,
				requestStatus: null
			};
		}
		api?.logger.info("[dom-debug] waitForSubjectListing: waiting for subject search result", {
			timeoutMs,
			searchStartedAtMs,
			allowAutoClick,
			snapshot: getAutoSearchSnapshot()
		});
		const requestPromise = waitForRequestComplete(KNOWN_ENDPOINTS.schedulableSubjects, timeoutMs, searchStartedAtMs);
		const requestTracker = {
			current: null,
			completedAtMs: null
		};
		requestPromise.then((result) => {
			requestTracker.current = result;
			requestTracker.completedAtMs = Date.now();
		}).catch((err) => {
			api?.logger.warn("[dom-debug] waitForSubjectListing: request observer failed", err);
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
				api?.logger.info("[dom-debug] waitForSubjectListing: panel count changed", {
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
			api?.logger.warn("[dom-debug] waitForSubjectListing: failed to observe DOM changes", err);
		}
		while (Date.now() - start < timeoutMs) {
			const panels = getSubjectPanels().length;
			if (panels > 0) {
				observer?.disconnect();
				const requestStatus = requestTracker.current ? requestTracker.current.status : null;
				api?.logger.info("[dom-debug] waitForSubjectListing: subjects loaded", {
					elapsedMs: Date.now() - start,
					panels,
					mutations: mutationCount,
					request: describeRequestResult(requestTracker.current)
				});
				return {
					state: "panels-loaded",
					panels,
					requestStatus
				};
			}
			const idleMs = Date.now() - lastMutationAt;
			const searchBtn = findSearchButton();
			if (searchBtn) {
				const interactable = isButtonInteractable$1(searchBtn);
				const candidateState = JSON.stringify({
					...describeButton(searchBtn),
					interactable
				});
				if (candidateState !== lastCandidateState) {
					lastCandidateState = candidateState;
					api?.logger.info("[dom-debug] waitForSubjectListing: observed search button candidate", {
						elapsedMs: Date.now() - start,
						...describeButton(searchBtn),
						interactable
					});
				}
				if (allowAutoClick && !delayedAutoClickTriggered && interactable && idleMs >= AUTO_SEARCH_STABLE_MS) {
					delayedAutoClickTriggered = true;
					searchBtn.click();
					api?.logger.info("[dom-debug] waitForSubjectListing: auto-clicked delayed search button", {
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
					api?.logger.warn("[dom-debug] waitForSubjectListing: subject search request failed", {
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
				const interactable = searchBtn ? isButtonInteractable$1(searchBtn) : false;
				if (idleMs >= AUTO_SEARCH_STABLE_MS && requestSettledForMs >= SEARCH_RESULT_SETTLE_GRACE_MS && (interactable || searchBtn === null)) {
					observer?.disconnect();
					api?.logger.info("[dom-debug] waitForSubjectListing: search settled without subject panels", {
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
		api?.logger.warn("[dom-debug] waitForSubjectListing: timed out waiting for subject listing", {
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
		if (panel.querySelector(".mat-expansion-panel-content[style*=\"visibility: visible\"]") !== null) return true;
		if (panel.querySelector("mat-expansion-panel-header")?.getAttribute("aria-expanded") === "true") return true;
		return false;
	}
	async function expandPanel(panel) {
		const api = getApi$1();
		if (isPanelExpanded(panel)) {
			api?.logger.info("[dom-debug] expandPanel: panel already expanded");
			return true;
		}
		const header = panel.querySelector("mat-expansion-panel-header");
		if (!header) {
			api?.logger.warn("[dom-debug] expandPanel: mat-expansion-panel-header not found");
			return false;
		}
		header.click();
		api?.logger.info("[dom-debug] expandPanel: clicked header, waiting for course items...");
		if (!await waitForElement(".course-list-item-container", panel)) {
			api?.logger.warn("[dom-debug] expandPanel: waitForElement timed out, using fallback delay");
			await delay(PLANNER_TIMING.panelExpandFallbackMs);
		}
		const result = isPanelExpanded(panel);
		api?.logger.info(`[dom-debug] expandPanel: completed, expanded=${result}`);
		return result;
	}
	function getCourseItems(panel) {
		return Array.from(panel.querySelectorAll(".course-list-item-container"));
	}
	function isCourseSelected(courseItem) {
		if (courseItem.classList.contains("course-list-item-container--selected")) return true;
		const checkbox = courseItem.querySelector("input[type=\"checkbox\"]");
		if (!checkbox) return false;
		if (checkbox.checked) return true;
		if (checkbox.getAttribute("aria-checked") === "true") return true;
		return false;
	}
	async function toggleCourse(courseItem) {
		const api = getApi$1();
		const wasBefore = isCourseSelected(courseItem);
		const label = courseItem.querySelector("mat-checkbox label, .mat-mdc-checkbox label");
		if (label) {
			api?.logger.info("[dom-debug] toggleCourse: clicking label target");
			label.click();
		} else {
			const touchTarget = courseItem.querySelector(".mat-mdc-checkbox-touch-target");
			if (touchTarget) {
				api?.logger.info("[dom-debug] toggleCourse: clicking touchTarget fallback");
				touchTarget.click();
			} else {
				const checkbox = courseItem.querySelector("mat-checkbox") ?? courseItem.querySelector(".mat-mdc-checkbox") ?? courseItem.querySelector("input[type=\"checkbox\"]");
				if (checkbox) {
					api?.logger.info("[dom-debug] toggleCourse: clicking checkbox fallback");
					checkbox.click();
				} else api?.logger.warn("[dom-debug] toggleCourse: no click target found");
			}
		}
		await delay(PLANNER_TIMING.domStateSettleMs);
		if (wasBefore === isCourseSelected(courseItem)) api?.logger.warn("toggleCourse: --selected class did not change after click");
	}
	async function loadStoredSelections() {
		const api = getApi$1();
		const selections = await loadSelections();
		const subjectCodes = Object.keys(selections);
		if (subjectCodes.length === 0) {
			api?.logger.info("no stored selections to load");
			api?.statusPanel.addMessage("info", "No saved course selections found.");
			return;
		}
		api?.logger.info(`loading selections for ${subjectCodes.length} subjects`);
		api?.statusPanel.addMessage("info", `Loading ${subjectCodes.length} saved subject${subjectCodes.length === 1 ? "" : "s"}...`);
		api?.logger.info(`[load-debug] loadStoredSelections: preparing to match ${subjectCodes.length} stored subjects on the live page`);
		let loadedCount = 0;
		for (const subjectCode of subjectCodes) {
			const courseCodes = selections[subjectCode];
			const panel = findSubjectPanel(subjectCode);
			if (!panel) {
				api?.logger.warn(`[load-debug] loadStoredSelections: subject ${subjectCode} not found on the live page - skipping`);
				continue;
			}
			api?.logger.info(`[load-debug] loadStoredSelections: expanding panel for ${subjectCode}...`);
			if (!await expandPanel(panel)) {
				api?.logger.warn(`[load-debug] loadStoredSelections: expansion failed for ${subjectCode}`);
				continue;
			}
			api?.logger.info(`[load-debug] loadStoredSelections: panel expanded for ${subjectCode}`);
			let matchedCourses = 0;
			for (const courseCode of courseCodes) {
				const livePanel = findSubjectPanel(subjectCode);
				if (!livePanel) {
					api?.logger.warn(`[load-debug] loadStoredSelections: subject ${subjectCode} disappeared after expansion`);
					break;
				}
				const items = getCourseItems(livePanel);
				api?.logger.info(`[load-debug] loadStoredSelections: ${items.length} live course items in ${subjectCode}, matching ${courseCode}`);
				const item = items.find((candidate) => extractCourseCode(candidate) === courseCode);
				if (!item) {
					api?.logger.warn(`[load-debug] loadStoredSelections: course ${courseCode} not found in ${subjectCode}`);
					continue;
				}
				if (!isCourseSelected(item)) {
					await toggleCourse(item);
					api?.logger.info(`[load-debug] loadStoredSelections: toggled course ${courseCode} in ${subjectCode}`);
				} else api?.logger.info(`[load-debug] loadStoredSelections: course ${courseCode} already selected in ${subjectCode}`);
				matchedCourses++;
			}
			api?.logger.info(`[load-debug] loadStoredSelections: matched ${matchedCourses}/${courseCodes.length} courses for ${subjectCode}`);
			if (matchedCourses > 0) loadedCount++;
			const verificationPanel = findSubjectPanel(subjectCode);
			const actualSelected = verificationPanel ? getCourseItems(verificationPanel).filter((item) => isCourseSelected(item)).length : 0;
			if (verificationPanel && actualSelected !== courseCodes.length) {
				const mismatchMsg = `${subjectCode}: ${actualSelected} selected in DOM vs ${courseCodes.length} requested`;
				api?.logger.warn(`[load-debug] loadStoredSelections: selection mismatch - ${mismatchMsg}`);
				api?.statusPanel.addMessage("warn", `Selection mismatch: ${mismatchMsg}`);
			}
		}
		api?.logger.info(`loaded selections for ${loadedCount} / ${subjectCodes.length} subjects`);
		api?.statusPanel.addMessage("info", `Loaded ${loadedCount}/${subjectCodes.length}. Review, then use Enroll Selected or enroll manually.`);
	}
	async function quickEnrollAll() {
		const api = getApi$1();
		if (getIsEnrolling()) {
			api?.logger.warn("enrollment already in progress");
			return;
		}
		setIsEnrolling(true);
		try {
			try {
				if (!sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)) {
					api?.logger.warn("no access_token in sessionStorage - session may have expired");
					api?.statusPanel.addMessage("error", "Session expired. Log in again before enrolling.");
					return;
				}
			} catch (err) {
				api?.logger.warn("cannot check sessionStorage for access_token:", err);
			}
			const panels = getSubjectPanels();
			const enrollable = panels.filter((panel) => {
				if (!isPanelExpanded(panel)) return false;
				return getCourseItems(panel).some((item) => isCourseSelected(item));
			});
			if (enrollable.length === 0) {
				const msg = panels.length === 0 ? "No subjects are listed. Search first, then load your saved courses." : "No courses are selected. Load saved courses first, or select them manually.";
				api?.logger.warn(msg);
				api?.statusPanel.addMessage("warn", msg);
				return;
			}
			api?.statusPanel.addMessage("info", `Enrolling ${enrollable.length} subject${enrollable.length === 1 ? "" : "s"}...`);
			let enrolled = 0;
			let failed = 0;
			const errors = [];
			for (const panel of enrollable) {
				const code = extractSubjectCode(panel) ?? "???";
				api?.logger.info(`[enroll-debug] enrolling ${code} (${enrolled + failed + 1}/${enrollable.length})`);
				api?.statusPanel.addMessage("info", `Enrolling ${code}... (${enrolled + failed + 1}/${enrollable.length})`);
				const enrollStartedAt = performance.now();
				if (!enrollSubject(panel, code)) {
					failed++;
					errors.push(`${code}: enroll button not found`);
					continue;
				}
				const requestResult = await waitForRequestComplete("SubjectApplication/SubjectSignin", 3e4, enrollStartedAt);
				if (!requestResult.completed) {
					failed++;
					errors.push(`${code}: timed out waiting for server response`);
					api?.logger.warn(`[enroll-debug] ${code}: no response within 30s`);
					continue;
				}
				if (requestResult.status !== null && requestResult.status >= 400) {
					failed++;
					errors.push(`${code}: server returned ${requestResult.status}`);
					api?.logger.warn(`[enroll-debug] ${code}: enrollment request completed with status=${requestResult.status}`);
					continue;
				}
				enrolled++;
				if (requestResult.status === null) api?.logger.info(`[enroll-debug] ${code}: enrollment request completed (status unavailable)`);
				else api?.logger.info(`[enroll-debug] ${code}: enrollment request completed with status=${requestResult.status}`);
			}
			let summary = `Done: ${enrolled} enrolled, ${failed} failed.`;
			if (errors.length > 0) summary += ` Errors: ${errors.join("; ")}`;
			api?.logger.info(summary);
			api?.statusPanel.addMessage(enrolled > 0 && failed === 0 ? "info" : "warn", summary);
		} finally {
			setIsEnrolling(false);
		}
	}
	var isLoadAndEnrolling = false;
	async function loadAndEnroll() {
		const api = getApi$1();
		if (getIsEnrolling() || isLoadAndEnrolling) {
			api?.logger.warn("enrollment already in progress");
			return;
		}
		isLoadAndEnrolling = true;
		try {
			const selections = await loadSelections();
			if (Object.keys(selections).length === 0) {
				api?.statusPanel.addMessage("warn", "No saved course selections. Save courses first.");
				return;
			}
			api?.statusPanel.addMessage("info", "Loading saved courses...");
			api?.statusPanel.expand();
			await loadStoredSelections();
			api?.statusPanel.addMessage("info", "Saved courses loaded. Starting enrollment...");
			await quickEnrollAll();
		} finally {
			isLoadAndEnrolling = false;
		}
	}
	function enrollSubject(panel, subjectCode) {
		const api = getApi$1();
		const enrollBtn = Array.from(panel.querySelectorAll("button")).find((btn) => isEnrollButtonText(btn.textContent ?? ""));
		if (!enrollBtn) {
			api?.logger.warn(`enroll button not found for ${subjectCode}`);
			return false;
		}
		enrollBtn.click();
		api?.logger.info(`[enroll-debug] clicked enroll for ${subjectCode}`);
		return true;
	}
	async function saveCurrentSelections() {
		const api = getApi$1();
		const panels = getSubjectPanels();
		api?.logger.info(`[save-debug] found ${panels.length} panels on page`);
		const existing = await loadSelections();
		let newCount = 0;
		for (const panel of panels) {
			const expanded = isPanelExpanded(panel);
			const headerText = (panel.querySelector("mat-expansion-panel-header")?.textContent ?? "").replace(/\s+/g, " ").trim().substring(0, 50);
			const courseItemCount = panel.querySelectorAll(".course-list-item-container").length;
			const selectedItemCount = panel.querySelectorAll(".course-list-item-container--selected").length;
			api?.logger.info(`[save-debug] panel "${headerText}": expanded=${expanded}, courses=${courseItemCount}, selected=${selectedItemCount}, classes=${panel.className.substring(0, 60)}`);
			if (!expanded) continue;
			const code = extractSubjectCode(panel);
			api?.logger.info(`[save-debug]   subjectCode=${code}`);
			if (!code) continue;
			const items = getCourseItems(panel);
			const selectedCodes = [];
			for (const item of items) {
				const isSelected = isCourseSelected(item);
				const courseCode = extractCourseCode(item);
				api?.logger.info(`[save-debug]   course=${courseCode}, selected=${isSelected}, classes=${item.className.substring(0, 60)}`);
				if (isSelected && courseCode) selectedCodes.push(courseCode);
			}
			if (selectedCodes.length > 0) {
				existing[code] = selectedCodes;
				newCount++;
				api?.logger.info(`[save-debug] saved ${selectedCodes.join(", ")} for ${code}`);
			}
		}
		if (newCount === 0) {
			api?.logger.warn("no selected courses found in expanded subjects");
			api?.statusPanel.addMessage("warn", "No selected courses found. Expand a subject and select courses first.");
			await renderModuleUI$1();
			return;
		}
		await saveSelections(existing);
		const totalSubjects = Object.keys(existing).length;
		api?.logger.info(`saved/updated ${newCount} subjects, total stored: ${totalSubjects}`, existing);
		api?.statusPanel.addMessage("info", `Saved ${newCount} subject${newCount === 1 ? "" : "s"}. Total stored: ${totalSubjects}.`);
		await renderModuleUI$1();
	}
	function isElementAvailable(element) {
		if (!element.isConnected) return false;
		if (element instanceof HTMLButtonElement && element.disabled) return false;
		let current = element;
		while (current) {
			if (current.hidden || current.hasAttribute("hidden") || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true" || current.getAttribute("aria-disabled") === "true") return false;
			const style = window.getComputedStyle(current);
			if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.pointerEvents === "none") return false;
			current = current.parentElement;
		}
		return true;
	}
	var runSequence = 0;
	function monotonicNow() {
		try {
			return performance.now();
		} catch {
			return Date.now();
		}
	}
	function formatDetails(details) {
		return Object.entries(details).filter(([, value]) => value !== void 0).map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`).join(" ");
	}
	function createPlannerDiagnostics(operation) {
		const startedAt = monotonicNow();
		const runId = `planner-${Date.now().toString(36)}-${++runSequence}`;
		return {
			runId,
			log(event, details = {}) {
				try {
					const elapsedMs = Math.round(monotonicNow() - startedAt);
					const tail = formatDetails(details);
					console.info(`[NPU:planner] ${runId} ${operation} +${elapsedMs}ms ${event}${tail ? ` ${tail}` : ""}`);
				} catch {}
			}
		};
	}
	var PLANNED_SUBJECTS_ENDPOINT = "SubjectApplication/ScheduledSubjectsWithScheduledCourses";
	var WARNING_MODAL_STATES_ENDPOINT = "ContextUserProfile/GetSubjectSigninWarningModalsStates";
	function readAccessToken() {
		try {
			return sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken);
		} catch {
			return null;
		}
	}
	function resolveApiBase() {
		try {
			const entry = performance.getEntriesByType("resource").map((resource) => resource.name).find((name) => name.includes("/api/SubjectApplication/"));
			if (entry) {
				const marker = entry.indexOf("/api/");
				if (marker !== -1) return entry.slice(0, marker + 5);
			}
		} catch {}
		const prefix = window.location.pathname.split("/")[1] || "hallgatoi";
		return `${window.location.origin}/${prefix}/api/`;
	}
	function resolveTermId() {
		let latest = null;
		try {
			for (const resource of performance.getEntriesByType("resource")) {
				if (!resource.name.includes("/api/SubjectApplication/")) continue;
				let termId = null;
				try {
					termId = new URL(resource.name).searchParams.get("request.termId");
				} catch {
					continue;
				}
				if (!termId) continue;
				if (!latest || resource.startTime >= latest.startTime) latest = {
					termId,
					startTime: resource.startTime
				};
			}
		} catch {
			return null;
		}
		return latest?.termId ?? null;
	}
	function isPlannerApiUsable() {
		return readAccessToken() !== null && resolveTermId() !== null;
	}
	function isRetryableStatus(status) {
		return status === 429 || status >= 500;
	}
	async function getJson(path, params) {
		const token = readAccessToken();
		if (!token) return {
			envelope: null,
			failure: "no-token",
			status: null
		};
		const url = new URL(resolveApiBase() + path);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		let lastStatus = null;
		let lastFailure = "network";
		for (let attempt = 1; attempt <= PLANNER_TIMING.apiMaxAttempts; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), PLANNER_TIMING.apiRequestTimeoutMs);
			try {
				const response = await fetch(url.toString(), {
					method: "GET",
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json"
					},
					credentials: "include",
					signal: controller.signal
				});
				lastStatus = response.status;
				if (response.status === 401 || response.status === 403) return {
					envelope: null,
					failure: "unauthorized",
					status: response.status
				};
				if (!response.ok) {
					lastFailure = "server-error";
					if (!isRetryableStatus(response.status)) return {
						envelope: null,
						failure: "server-error",
						status: response.status
					};
				} else try {
					return {
						envelope: await response.json(),
						failure: null,
						status: response.status
					};
				} catch {
					return {
						envelope: null,
						failure: "malformed",
						status: response.status
					};
				}
			} catch {
				lastFailure = "network";
			} finally {
				clearTimeout(timer);
			}
			if (attempt < PLANNER_TIMING.apiMaxAttempts) await delay(PLANNER_TIMING.apiRetryBaseDelayMs * attempt);
		}
		return {
			envelope: null,
			failure: lastFailure,
			status: lastStatus
		};
	}
	function asRecord(value) {
		return typeof value === "object" && value !== null ? value : null;
	}
	function toPlannedSubject(raw) {
		const record = asRecord(raw);
		if (!record) return null;
		const code = typeof record.code === "string" ? record.code.trim() : "";
		if (!code) return null;
		const courseIds = Array.isArray(record.scheduledCourseIds) ? record.scheduledCourseIds.filter((id) => typeof id === "string") : [];
		const uiState = asRecord(record.uiDisplayState);
		return {
			code,
			title: typeof record.title === "string" ? record.title : "",
			scheduledCourseIds: courseIds,
			isRegistered: record.isRegistered === true,
			isWaiting: record.isWaiting === true,
			isInProgress: record.isInProgress === true,
			isCompleted: record.isCompleted === true,
			uiDisplayStateType: typeof uiState?.type === "number" ? uiState.type : null
		};
	}
	async function fetchPlannedSubjects(termId) {
		const resolvedTermId = termId ?? resolveTermId();
		if (!resolvedTermId) return {
			ok: false,
			failure: "no-term",
			status: null,
			subjects: []
		};
		const { envelope, failure, status } = await getJson(PLANNED_SUBJECTS_ENDPOINT, {
			"request.termId": resolvedTermId,
			"request.withRegisteredSubjects": "true"
		});
		if (failure) return {
			ok: false,
			failure,
			status,
			subjects: []
		};
		if (!Array.isArray(envelope?.data)) return {
			ok: false,
			failure: "malformed",
			status,
			subjects: []
		};
		return {
			ok: true,
			failure: null,
			status,
			subjects: envelope.data.map(toPlannedSubject).filter((subject) => subject !== null)
		};
	}
	async function fetchWarningModalStates() {
		if (!isPlannerApiUsable()) return {
			scheduledCoursesInTimetableSuppressed: null,
			oneSubjectCanBeTakenSuppressed: null
		};
		const { envelope } = await getJson(WARNING_MODAL_STATES_ENDPOINT, {});
		const data = asRecord(envelope?.data);
		return {
			scheduledCoursesInTimetableSuppressed: typeof data?.scheduledCoursesInTimetableDontAppearAgain === "boolean" ? data.scheduledCoursesInTimetableDontAppearAgain : null,
			oneSubjectCanBeTakenSuppressed: typeof data?.oneSubjectCanBeTakenDontAppearAgain === "boolean" ? data.oneSubjectCanBeTakenDontAppearAgain : null
		};
	}
	var PLANNER_ROOT_SELECTOR = "neptun-timetable-planner";
	var PLANNER_LIST_SELECTOR = "neptun-timetable-planner-list-view";
	var PLANNER_TOGGLE_SELECTOR = "button.timetable-planner__toggle-button";
	var PLANNER_VIEW_SELECT_ID = "timetable-planner-view-typeSelect";
	var PLANNER_SUBJECT_CONTAINER_ID_PREFIX = "signed-and-scheduled-subjects";
	function normalizeText$1(text) {
		return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
	}
	function isListViewText(text) {
		const normalized = normalizeText$1(text);
		return normalized.includes("lista nezet") || normalized.includes("list view");
	}
	function isPlannerExplicitlyEmpty(root) {
		const text = normalizeText$1(root.textContent ?? "");
		if (!text) return false;
		return [
			"nincs megjelenitheto adat",
			"nincs tervezohoz adott targy",
			"no planned subjects",
			"no data to display"
		].some((message) => text.includes(message));
	}
	function getPlannerRoot() {
		return document.querySelector(PLANNER_ROOT_SELECTOR);
	}
	function isInPlannerScope(element) {
		return element.closest(`${PLANNER_ROOT_SELECTOR}, ${PLANNER_LIST_SELECTOR}`) !== null;
	}
	function getPlannerListRoot() {
		return Array.from(document.querySelectorAll(PLANNER_LIST_SELECTOR)).find((root) => isElementAvailable(root)) ?? null;
	}
	function getPlannerSubjectPanels(root) {
		const scoped = Array.from(root.querySelectorAll("neptun-subject-list-item mat-expansion-panel"));
		return (scoped.length > 0 ? scoped : Array.from(root.querySelectorAll("mat-expansion-panel"))).filter(isPlannerSubjectPanel);
	}
	function isPlannerSubjectPanel(panel) {
		if (!isInPlannerScope(panel)) return false;
		const id = panel.closest("[id]")?.id ?? "";
		if (!id) return true;
		return !id.startsWith("subject-registration") || id.startsWith(PLANNER_SUBJECT_CONTAINER_ID_PREFIX);
	}
	function isPlannerToggleText(text) {
		const normalized = normalizeText$1(text);
		return normalized.includes("orarendtervezo") || normalized.includes("timetable planner");
	}
	function findPlannerToggle() {
		const availableExact = Array.from(document.querySelectorAll(PLANNER_TOGGLE_SELECTOR)).find((button) => isElementAvailable(button));
		if (availableExact) return availableExact;
		return Array.from(document.querySelectorAll("button")).find((button) => isElementAvailable(button) && isPlannerToggleText(`${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`)) ?? null;
	}
	function findPlannerViewControl() {
		const exact = document.getElementById(PLANNER_VIEW_SELECT_ID);
		if (exact && isElementAvailable(exact)) return exact;
		const planner = getPlannerRoot();
		if (!planner) return null;
		return Array.from(planner.querySelectorAll(`#${PLANNER_VIEW_SELECT_ID}, neptun-form-select-v2 mat-select, neptun-form-select-v2 [role="combobox"], neptun-form-select-v2`)).find((control) => isElementAvailable(control)) ?? null;
	}
	function getViewClickTarget(control) {
		return control.querySelector("[role=\"combobox\"], mat-select, .mat-mdc-select-trigger") ?? control;
	}
	function findListViewOption() {
		return Array.from(document.querySelectorAll("mat-option, [role=\"option\"]")).find((option) => isElementAvailable(option) && isListViewText(option.textContent ?? "")) ?? null;
	}
	function readPlannerOpenState() {
		if (getPlannerListRoot() || findPlannerViewControl()) return "open";
		const toggle = findPlannerToggle();
		if (!toggle) return "unknown";
		const label = normalizeText$1(`${toggle.getAttribute("aria-label") ?? ""} ${toggle.textContent ?? ""}`);
		if (label.includes("megnyit") || label.includes("open")) return "closed";
		if (label.includes("bezar") || label.includes("close")) return "open";
		if (isPlannerToggleText(label)) return "closed";
		return "unknown";
	}
	var ControlActionGate = class {
		lastActionAt = new Map();
		attempts = new Map();
		canAct(key, cooldownMs) {
			if (this.attemptsFor(key) >= PLANNER_TIMING.controlActionMaxAttempts) return false;
			const last = this.lastActionAt.get(key);
			return last === void 0 || Date.now() - last >= cooldownMs;
		}
		record(key) {
			this.lastActionAt.set(key, Date.now());
			this.attempts.set(key, this.attemptsFor(key) + 1);
		}
		attemptsFor(key) {
			return this.attempts.get(key) ?? 0;
		}
	};
	async function acquirePlannerListView(deadline, diagnostics) {
		const gate = new ControlActionGate();
		let openedPlanner = false;
		let switchedToList = false;
		let lastState = "";
		while (Date.now() < deadline) {
			const listRoot = getPlannerListRoot();
			if (listRoot) return {
				root: listRoot,
				openedPlanner,
				switchedToList,
				error: null
			};
			const openState = readPlannerOpenState();
			const viewControl = findPlannerViewControl();
			const state = `${openState}|${viewControl ? "view" : "no-view"}`;
			if (state !== lastState) {
				lastState = state;
				diagnostics.log("acquire:state", {
					open: openState,
					viewControl: viewControl !== null,
					toggleAttempts: gate.attemptsFor("toggle"),
					viewAttempts: gate.attemptsFor("view")
				});
			}
			if (openState === "closed") {
				const toggle = findPlannerToggle();
				if (toggle && gate.canAct("toggle", PLANNER_TIMING.controlActionSettleMs)) {
					diagnostics.log("acquire:toggle-click", { attempt: gate.attemptsFor("toggle") + 1 });
					toggle.click();
					gate.record("toggle");
					openedPlanner = true;
				}
				await delay(PLANNER_TIMING.domPollIntervalMs);
				continue;
			}
			if (viewControl && !isListViewText(viewControl.textContent ?? "")) {
				const listOption = findListViewOption();
				if (listOption) {
					diagnostics.log("acquire:list-option-click");
					listOption.click();
					gate.record("view");
					switchedToList = true;
				} else if (gate.canAct("view", PLANNER_TIMING.controlActionCooldownMs)) {
					diagnostics.log("acquire:view-selector-click", { attempt: gate.attemptsFor("view") + 1 });
					getViewClickTarget(viewControl).click();
					gate.record("view");
				}
			}
			await delay(PLANNER_TIMING.domPollIntervalMs);
		}
		return {
			root: null,
			openedPlanner,
			switchedToList,
			error: describeAcquisitionFailure(readPlannerOpenState(), gate)
		};
	}
	function describeAcquisitionFailure(state, gate) {
		if (state === "unknown") return "Neptun timetable planner toggle action could not be identified safely";
		if (state === "closed") return gate.attemptsFor("toggle") > 0 ? `Neptun timetable planner did not stay open after ${gate.attemptsFor("toggle")} attempts` : "Neptun timetable planner did not open in time";
		return "Neptun timetable planner list did not render in time";
	}
	async function preparePlannerListView(options = {}) {
		const diagnostics = options.diagnostics ?? createPlannerDiagnostics(options.operation ?? "prepare");
		const timeoutMs = options.entryPointTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs;
		diagnostics.log("prepare:start", {
			readinessTimeoutMs: timeoutMs,
			pollIntervalMs: PLANNER_TIMING.domPollIntervalMs
		});
		const result = await acquirePlannerListView(Date.now() + timeoutMs, diagnostics);
		diagnostics.log(result.root ? "prepare:ready" : "prepare:failed", {
			openedPlanner: result.openedPlanner,
			switchedToList: result.switchedToList,
			failure: result.error
		});
		return result;
	}
	function findEnrollmentButton$1(panel) {
		return Array.from(panel.querySelectorAll("button")).find((button) => isEnrollButtonText(button.textContent ?? "")) ?? null;
	}
	function countSelectedCourseItems(panel) {
		return getCourseItems(panel).filter((item) => isCourseSelected(item)).length;
	}
	function readExpandedPlannerSubject(subjectCode, panel) {
		const selectedCourseItems = getCourseItems(panel).filter((item) => isCourseSelected(item));
		const courseCodes = Array.from(new Set(selectedCourseItems.map((item) => extractCourseCode(item)).filter((code) => code !== null)));
		const enrollmentButton = findEnrollmentButton$1(panel);
		let issue = null;
		if (selectedCourseItems.length === 0) issue = `${subjectCode}: no planned course is selected`;
		else if (courseCodes.length !== selectedCourseItems.length) issue = `${subjectCode}: one or more planned course codes could not be read`;
		else if (!enrollmentButton) issue = `${subjectCode}: already registered or enrollment action unavailable`;
		else if (!isElementAvailable(enrollmentButton)) issue = `${subjectCode}: enrollment action unavailable`;
		return {
			subjectCode,
			panel,
			selectedCourseItems,
			courseCodes,
			enrollmentButton,
			available: issue === null,
			issue
		};
	}
	function readPlannerSubjectTarget(subjectCode, preferredPanel) {
		const root = getPlannerListRoot();
		if (!root) return null;
		let panel = preferredPanel?.isConnected && root.contains(preferredPanel) ? preferredPanel : void 0;
		if (!panel) {
			const matches = getPlannerSubjectPanels(root).filter((candidate) => extractSubjectCode(candidate) === subjectCode);
			if (matches.length !== 1) return null;
			panel = matches[0];
		}
		return readExpandedPlannerSubject(subjectCode, panel);
	}
	async function waitForStableSubjectList(root, deadline, apiPlannedCount, diagnostics) {
		let lastSignature = "";
		let stableSince = Date.now();
		while (Date.now() < deadline) {
			const panels = getPlannerSubjectPanels(root);
			const codes = panels.map((panel) => extractSubjectCode(panel));
			if (panels.length > 0 && codes.every((code) => code !== null)) {
				const matchesApi = apiPlannedCount === null || panels.length >= apiPlannedCount;
				const signature = codes.join("|");
				if (matchesApi && signature === lastSignature) {
					if (Date.now() - stableSince >= PLANNER_TIMING.listStabilityWindowMs) return {
						panels,
						explicitlyEmpty: false
					};
				} else {
					lastSignature = signature;
					stableSince = Date.now();
				}
			}
			if (apiPlannedCount === 0) {
				diagnostics.log("subject-list:empty-confirmed-by-api");
				return {
					panels: [],
					explicitlyEmpty: true
				};
			}
			if (panels.length === 0 && isPlannerExplicitlyEmpty(root)) {
				diagnostics.log("subject-list:empty-state-rendered");
				return {
					panels: [],
					explicitlyEmpty: true
				};
			}
			await delay(PLANNER_TIMING.domPollIntervalMs);
		}
		return {
			panels: getPlannerSubjectPanels(root),
			explicitlyEmpty: false
		};
	}
	async function collectPlannerSnapshot(options = {}) {
		const diagnostics = options.diagnostics ?? createPlannerDiagnostics(options.operation ?? "prepare");
		const contentTimeoutMs = options.contentTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs;
		const apiPromise = fetchPlannedSubjects().catch(() => null);
		const preparation = await preparePlannerListView({
			...options,
			diagnostics
		});
		const apiResult = await apiPromise;
		const plannedFromApi = apiResult?.ok ? apiResult.subjects : null;
		const apiPlannedCount = plannedFromApi?.length ?? null;
		diagnostics.log("api:planned-subjects", {
			ok: apiResult?.ok ?? false,
			failure: apiResult ? apiResult.failure ?? "none" : "unavailable",
			count: apiPlannedCount
		});
		if (!preparation.root) return {
			diagnosticRunId: diagnostics.runId,
			preparation,
			contentReady: false,
			listedSubjects: 0,
			subjects: [],
			plannedFromApi,
			issues: [preparation.error ?? "Neptun timetable planner list is unavailable"]
		};
		const issues = [];
		const subjects = [];
		const contentDeadline = Date.now() + contentTimeoutMs;
		diagnostics.log("subject-list:waiting", {
			timeoutMs: contentTimeoutMs,
			stabilityWindowMs: PLANNER_TIMING.listStabilityWindowMs,
			expectedFromApi: apiPlannedCount
		});
		const { panels: plannerPanels, explicitlyEmpty } = await waitForStableSubjectList(preparation.root, contentDeadline, apiPlannedCount, diagnostics);
		const subjectEntries = plannerPanels.map((panel) => ({
			panel,
			subjectCode: extractSubjectCode(panel)
		})).filter((entry) => entry.subjectCode !== null);
		if (subjectEntries.length === 0) {
			diagnostics.log("snapshot:complete", {
				contentReady: explicitlyEmpty,
				listedSubjects: plannerPanels.length,
				readableSubjects: 0,
				issueCount: 1
			});
			return {
				diagnosticRunId: diagnostics.runId,
				preparation,
				contentReady: explicitlyEmpty,
				listedSubjects: plannerPanels.length,
				subjects,
				plannedFromApi,
				issues: [explicitlyEmpty ? "No planned subjects are visible in Neptun timetable planner list view" : plannerPanels.length === 0 ? "Neptun timetable planner subjects did not finish loading" : "Planner subjects are visible, but their subject codes could not be read safely"]
			};
		}
		diagnostics.log("subject-list:ready", {
			panelCount: plannerPanels.length,
			readableCount: subjectEntries.length
		});
		const expandedEntries = [];
		for (const { subjectCode, panel } of subjectEntries) {
			if (!panel.isConnected) {
				issues.push(`${subjectCode}: planner subject disappeared before expansion`);
				continue;
			}
			if (!await expandPanel(panel)) {
				issues.push(`${subjectCode}: planner subject could not be expanded`);
				continue;
			}
			expandedEntries.push({
				subjectCode,
				panel
			});
		}
		diagnostics.log("subject-panels:expanded", {
			expandedCount: expandedEntries.length,
			failedCount: subjectEntries.length - expandedEntries.length
		});
		const expectedSelectedBySubject = new Map();
		for (const planned of plannedFromApi ?? []) expectedSelectedBySubject.set(planned.code, planned.scheduledCourseIds.length);
		const emptySelectionGraceMs = Math.max(PLANNER_TIMING.emptySelectionGraceMinMs, Math.round(contentTimeoutMs * PLANNER_TIMING.emptySelectionGraceRatio));
		diagnostics.log("course-rows:waiting", {
			timeoutMs: contentTimeoutMs,
			expectationSource: expectedSelectedBySubject.size > 0 ? "api" : "stability",
			stabilityWindowMs: PLANNER_TIMING.courseSelectionStabilityWindowMs,
			emptySelectionGraceMs
		});
		const readSelectionSignature = () => expandedEntries.map(({ subjectCode, panel }) => `${subjectCode}:${countSelectedCourseItems(panel)}`).join("|");
		const waitStartedAt = Date.now();
		const emptySelectionDeadline = waitStartedAt + emptySelectionGraceMs;
		let lastSignature = readSelectionSignature();
		let signatureStableSince = Date.now();
		while (Date.now() < contentDeadline) {
			const signature = readSelectionSignature();
			if (signature !== lastSignature) {
				lastSignature = signature;
				signatureStableSince = Date.now();
			}
			const everyPanelHasRows = expandedEntries.every(({ panel }) => getCourseItems(panel).length > 0);
			const selectionResolved = expandedEntries.every(({ subjectCode, panel }) => {
				const expected = expectedSelectedBySubject.get(subjectCode);
				const actual = countSelectedCourseItems(panel);
				if (expected !== void 0) return actual >= expected;
				return actual > 0 || Date.now() >= emptySelectionDeadline;
			});
			const selectionSettled = Date.now() - signatureStableSince >= PLANNER_TIMING.courseSelectionStabilityWindowMs;
			if (everyPanelHasRows && selectionResolved && selectionSettled) break;
			await delay(PLANNER_TIMING.domPollIntervalMs);
		}
		const unmetExpectations = expandedEntries.filter(({ subjectCode, panel }) => {
			const expected = expectedSelectedBySubject.get(subjectCode);
			return expected !== void 0 && countSelectedCourseItems(panel) < expected;
		}).length;
		diagnostics.log("course-rows:ready", {
			waitedMs: Date.now() - waitStartedAt,
			selectedRows: expandedEntries.reduce((sum, { panel }) => sum + countSelectedCourseItems(panel), 0),
			expectedRows: expectedSelectedBySubject.size > 0 ? Array.from(expectedSelectedBySubject.values()).reduce((sum, count) => sum + count, 0) : null,
			unmetExpectations
		});
		for (const { subjectCode, panel } of expandedEntries) {
			if (getCourseItems(panel).length === 0) {
				issues.push(`${subjectCode}: planner course rows did not finish loading`);
				continue;
			}
			const liveTarget = readPlannerSubjectTarget(subjectCode, panel);
			if (!liveTarget) {
				issues.push(`${subjectCode}: planner subject disappeared after expansion`);
				continue;
			}
			subjects.push(liveTarget);
			if (liveTarget.issue) issues.push(liveTarget.issue);
		}
		diagnostics.log("snapshot:complete", {
			contentReady: true,
			listedSubjects: plannerPanels.length,
			readableSubjects: subjects.length,
			issueCount: issues.length
		});
		return {
			diagnosticRunId: diagnostics.runId,
			preparation,
			contentReady: true,
			listedSubjects: plannerPanels.length,
			subjects,
			plannedFromApi,
			issues
		};
	}
	function closePlannerSafely() {
		if (readPlannerOpenState() !== "open") return false;
		const toggle = findPlannerToggle();
		if (!toggle) return false;
		toggle.click();
		return true;
	}
	var ENROLLMENT_ENDPOINT = "SubjectApplication/SubjectSignin";
	var plannerEnrollmentInFlight = null;
	function emptyResult(error) {
		return {
			plannerReady: false,
			openedPlanner: false,
			listedSubjects: 0,
			plannedSubjects: 0,
			eligibleSubjects: 0,
			attempted: 0,
			enrolled: 0,
			failed: 0,
			skipped: 0,
			unconfirmed: 0,
			aborted: false,
			errors: error ? [error] : []
		};
	}
	function normalizeCodes(codes) {
		return codes.map((code) => code.replace(/\s+/g, "").toUpperCase()).sort();
	}
	function courseSelectionMatches(expected, actual) {
		const normalizedExpected = normalizeCodes(expected);
		const normalizedActual = normalizeCodes(actual);
		return normalizedExpected.length === normalizedActual.length && normalizedExpected.every((code, index) => code === normalizedActual[index]);
	}
	function normalizeDialogText(text) {
		return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
	}
	function isEnrollmentConfirmationDialog(dialog) {
		const text = normalizeDialogText(dialog.textContent ?? "");
		if (text.includes("confirm subject registration") || text.includes("biztosan felveszi") || text.includes("targyfelvetel megerositese")) return true;
		const buttonLabels = Array.from(dialog.querySelectorAll("button")).map((button) => normalizeDialogText(button.textContent ?? ""));
		const hasAccept = buttonLabels.some((label) => [
			"igen",
			"yes",
			"ok"
		].includes(label));
		const hasReject = buttonLabels.some((label) => [
			"nem",
			"no",
			"megse",
			"cancel"
		].includes(label));
		return hasAccept && hasReject;
	}
	function getVisibleDialogs() {
		return Array.from(document.querySelectorAll("[role=\"dialog\"], mat-dialog-container, .mat-mdc-dialog-container")).filter((dialog) => isElementAvailable(dialog) && isEnrollmentConfirmationDialog(dialog));
	}
	function getVisibleNotificationState() {
		return Array.from(document.querySelectorAll(".cdk-overlay-pane, [role=\"status\"], [aria-live=\"polite\"], [aria-live=\"assertive\"]")).filter((element) => isElementAvailable(element) && !isEnrollmentConfirmationDialog(element)).map((element) => normalizeDialogText(element.textContent ?? "")).filter(Boolean).join("|");
	}
	function isFailureNotification(text) {
		return [
			"sikertelen",
			"failed",
			"hiba",
			"error",
			"nincs targyjelentkezesi idoszak"
		].some((marker) => text.includes(marker));
	}
	var RUN_FATAL_NOTIFICATION_MARKERS = [
		"nincs targyjelentkezesi idoszak",
		"no subject registration period",
		"lejart a targyjelentkezesi idoszak"
	];
	function isRunFatalNotification(text) {
		return RUN_FATAL_NOTIFICATION_MARKERS.some((marker) => text.includes(marker));
	}
	async function waitForNewNotification(notificationStateBeforeClick, timeoutMs = PLANNER_TIMING.notificationSettleMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const current = getVisibleNotificationState();
			if (current && current !== notificationStateBeforeClick) return current;
			await delay(PLANNER_TIMING.outcomePollIntervalMs);
		}
		return getVisibleNotificationState();
	}
	function classifyFailure(status, notification) {
		if (isRunFatalNotification(notification)) return "run-fatal";
		if (isFailureNotification(notification)) return "rejected";
		if (status === 429 || status === 502 || status === 503 || status === 504) return "retryable";
		return "rejected";
	}
	function getEnrollmentRequests() {
		try {
			return performance.getEntriesByType("resource").filter((entry) => entry.name.includes(ENROLLMENT_ENDPOINT));
		} catch {
			return [];
		}
	}
	async function waitForEnrollmentOutcome(requestsBeforeClick, dialogsBeforeClick, timeoutMs = PLANNER_TIMING.enrollmentRequestTimeoutMs) {
		const startedWaitingAt = Date.now();
		while (Date.now() - startedWaitingAt < timeoutMs) {
			if (getVisibleDialogs().find((dialog) => !dialogsBeforeClick.has(dialog))) return { type: "confirmation-required" };
			const requests = getEnrollmentRequests();
			const request = requests.length > requestsBeforeClick ? requests[requests.length - 1] : null;
			if (request) {
				const responseStatus = request.responseStatus;
				return {
					type: "request",
					status: typeof responseStatus === "number" ? responseStatus : null
				};
			}
			await delay(PLANNER_TIMING.outcomePollIntervalMs);
		}
		return { type: "timeout" };
	}
	function hasVisibleEnrollmentAction(subjectCode) {
		const root = getPlannerListRoot();
		if (!root) return false;
		return getPlannerSubjectPanels(root).filter((panel) => extractSubjectCode(panel) === subjectCode).some((panel) => Array.from(panel.querySelectorAll("button")).some((button) => isEnrollButtonText(button.textContent ?? "") && isElementAvailable(button)));
	}
	async function waitForPlannerUiOutcome(subjectCode, notificationStateBeforeClick, timeoutMs = PLANNER_TIMING.enrollmentUiUpdateTimeoutMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			if (!hasVisibleEnrollmentAction(subjectCode)) return "updated";
			const notificationState = getVisibleNotificationState();
			if (notificationState !== notificationStateBeforeClick && isFailureNotification(notificationState)) return "failure-notification";
			await delay(PLANNER_TIMING.outcomePollIntervalMs);
		}
		return "timeout";
	}
	async function confirmEnrollment(subjectCode, apiUsable, notificationStateBeforeClick, diagnostics) {
		if (apiUsable) {
			await delay(PLANNER_TIMING.apiConfirmationDelayMs);
			const refreshed = await fetchPlannedSubjects().catch(() => null);
			if (refreshed?.ok) {
				const match = refreshed.subjects.find((subject) => subject.code === subjectCode);
				diagnostics.log("confirm:api", {
					found: match !== void 0,
					isRegistered: match?.isRegistered ?? null
				});
				if (!match) return "registered";
				return match.isRegistered ? "registered" : "rejected";
			}
			diagnostics.log("confirm:api-unavailable", { failure: refreshed?.failure ?? "error" });
		}
		const uiOutcome = await waitForPlannerUiOutcome(subjectCode, notificationStateBeforeClick);
		diagnostics.log("confirm:ui", { outcome: uiOutcome });
		if (uiOutcome === "updated") return "registered";
		if (uiOutcome === "failure-notification") return "rejected";
		return "unknown";
	}
	function validateTarget(target) {
		const liveTarget = readPlannerSubjectTarget(target.subjectCode, target.panel);
		if (!liveTarget || !liveTarget.available || !liveTarget.enrollmentButton || !courseSelectionMatches(target.courseCodes, liveTarget.courseCodes)) return null;
		return liveTarget;
	}
	async function enrollSingleSubject(target, apiUsable, diagnostics, targetIndex) {
		let lastError = `${target.subjectCode}: enrollment did not complete`;
		for (let attempt = 1; attempt <= PLANNER_TIMING.enrollmentMaxAttempts; attempt++) {
			const liveTarget = validateTarget(target);
			if (!liveTarget?.enrollmentButton) {
				if (attempt > 1) {
					if (await confirmEnrollment(target.subjectCode, apiUsable, "", diagnostics) === "registered") return {
						outcome: "enrolled",
						error: null
					};
					return {
						outcome: "failed",
						error: lastError
					};
				}
				return {
					outcome: "selection-changed",
					error: `${target.subjectCode}: planner selection changed before enrollment`
				};
			}
			const dialogsBeforeClick = new Set(getVisibleDialogs());
			const notificationStateBeforeClick = getVisibleNotificationState();
			const requestsBeforeClick = getEnrollmentRequests().length;
			diagnostics.log("target:click", {
				targetIndex,
				attempt,
				priorRequestCount: requestsBeforeClick
			});
			liveTarget.enrollmentButton.click();
			const outcome = await waitForEnrollmentOutcome(requestsBeforeClick, dialogsBeforeClick);
			diagnostics.log("target:request-outcome", {
				targetIndex,
				attempt,
				outcome: outcome.type,
				status: outcome.type === "request" ? outcome.status : null
			});
			if (outcome.type === "confirmation-required") return {
				outcome: "aborted",
				error: `${target.subjectCode}: Neptun registration confirmation popup is enabled`
			};
			if (outcome.type === "timeout") {
				const confirmation = await confirmEnrollment(target.subjectCode, apiUsable, notificationStateBeforeClick, diagnostics);
				if (confirmation === "registered") return {
					outcome: "enrolled",
					error: null
				};
				return {
					outcome: confirmation === "rejected" ? "failed" : "unconfirmed",
					error: `${target.subjectCode}: timed out waiting for Neptun`
				};
			}
			if (outcome.status !== null && outcome.status >= 400) {
				const notification = await waitForNewNotification(notificationStateBeforeClick);
				const classification = classifyFailure(outcome.status, notification);
				diagnostics.log("target:failure-classified", {
					targetIndex,
					attempt,
					status: outcome.status,
					classification
				});
				lastError = `${target.subjectCode}: server returned ${outcome.status}`;
				if (classification === "run-fatal") return {
					outcome: "run-fatal",
					error: `${target.subjectCode}: Neptun reports there is no open registration period`
				};
				if (classification === "rejected") return {
					outcome: "failed",
					error: lastError
				};
				if (attempt < PLANNER_TIMING.enrollmentMaxAttempts) {
					diagnostics.log("target:retry", {
						targetIndex,
						attempt,
						status: outcome.status
					});
					await delay(PLANNER_TIMING.enrollmentRetryBaseDelayMs * attempt);
				}
				continue;
			}
			const confirmation = await confirmEnrollment(target.subjectCode, apiUsable, notificationStateBeforeClick, diagnostics);
			if (confirmation === "registered") return {
				outcome: "enrolled",
				error: null
			};
			if (confirmation === "rejected") return {
				outcome: "failed",
				error: `${target.subjectCode}: Neptun reported enrollment failure`
			};
			return {
				outcome: "unconfirmed",
				error: `${target.subjectCode}: request completed but enrollment could not be confirmed`
			};
		}
		return {
			outcome: "failed",
			error: lastError
		};
	}
	async function runPlannerEnrollment(options) {
		const api = getApi$1();
		const diagnostics = createPlannerDiagnostics("enroll");
		const readinessTimeoutMs = options.plannerWaitTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs;
		diagnostics.log("enroll:start", {
			readinessTimeoutMs,
			requestTimeoutMs: PLANNER_TIMING.enrollmentRequestTimeoutMs,
			maxAttemptsPerSubject: PLANNER_TIMING.enrollmentMaxAttempts
		});
		const snapshot = await collectPlannerSnapshot({
			entryPointTimeoutMs: readinessTimeoutMs,
			contentTimeoutMs: readinessTimeoutMs,
			diagnostics,
			operation: "enroll"
		});
		const apiUsable = snapshot.plannedFromApi !== null;
		const registeredCodes = new Set((snapshot.plannedFromApi ?? []).filter((subject) => subject.isRegistered).map((subject) => subject.code));
		const eligibleTargets = snapshot.subjects.filter((subject) => subject.available && subject.enrollmentButton && !registeredCodes.has(subject.subjectCode));
		const result = {
			plannerReady: snapshot.preparation.root !== null && snapshot.contentReady,
			openedPlanner: snapshot.preparation.openedPlanner,
			listedSubjects: snapshot.listedSubjects,
			plannedSubjects: snapshot.subjects.length,
			eligibleSubjects: eligibleTargets.length,
			attempted: 0,
			enrolled: 0,
			failed: 0,
			skipped: snapshot.subjects.length - eligibleTargets.length,
			unconfirmed: 0,
			aborted: false,
			errors: [...snapshot.issues]
		};
		diagnostics.log("enroll:targets", {
			listedSubjects: result.listedSubjects,
			readableSubjects: result.plannedSubjects,
			eligibleSubjects: result.eligibleSubjects,
			skippedSubjects: result.skipped,
			alreadyRegistered: registeredCodes.size,
			apiUsable
		});
		if (!snapshot.preparation.root || !snapshot.contentReady) {
			diagnostics.log("enroll:blocked", { reason: "planner-not-ready" });
			api?.statusPanel.addMessage("warn", `${snapshot.preparation.error ?? (snapshot.issues.join("; ") || "Neptun timetable planner list is unavailable.")} Console run: ${diagnostics.runId}.`);
			return result;
		}
		if (eligibleTargets.length === 0) {
			diagnostics.log("enroll:blocked", { reason: "no-eligible-targets" });
			api?.statusPanel.addMessage("warn", registeredCodes.size > 0 && registeredCodes.size === snapshot.subjects.length ? `All ${registeredCodes.size} planned subjects are already registered. Nothing was clicked.` : `No enrollable planned subjects were found. Preview the planner and review unavailable items. Console run: ${diagnostics.runId}.`);
			return result;
		}
		try {
			if (!sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)) {
				result.aborted = true;
				result.errors.push("Session expired");
				diagnostics.log("enroll:blocked", { reason: "session-expired" });
				api?.statusPanel.addMessage("error", `Session expired. Log in again before enrolling. Console run: ${diagnostics.runId}.`);
				return result;
			}
		} catch (error) {
			api?.logger.warn("cannot check sessionStorage before planner enrollment:", error);
		}
		if ((await fetchWarningModalStates().catch(() => null))?.scheduledCoursesInTimetableSuppressed === false) {
			diagnostics.log("enroll:warning-modal-active");
			api?.statusPanel.addMessage("warn", "Neptun’s registration confirmation popup is still enabled. If it appears, the run stops safely — tick “do not show again” in Neptun to avoid that.");
		}
		api?.statusPanel.expand();
		api?.statusPanel.addMessage("info", `Enrolling ${eligibleTargets.length} planned subject${eligibleTargets.length === 1 ? "" : "s"} sequentially...`);
		for (const [targetIndex, target] of eligibleTargets.entries()) {
			if (!validateTarget(target)?.enrollmentButton) {
				result.failed++;
				result.errors.push(`${target.subjectCode}: planner selection changed before enrollment`);
				diagnostics.log("target:skipped", {
					targetIndex,
					reason: "selection-changed"
				});
				continue;
			}
			result.attempted++;
			api?.statusPanel.addMessage("info", `Enrolling ${target.subjectCode}... (${result.attempted}/${eligibleTargets.length})`);
			const attemptResult = await enrollSingleSubject(target, apiUsable, diagnostics, targetIndex);
			if (attemptResult.error) result.errors.push(attemptResult.error);
			if (attemptResult.outcome === "enrolled") {
				result.enrolled++;
				continue;
			}
			if (attemptResult.outcome === "unconfirmed") {
				result.unconfirmed++;
				continue;
			}
			if (attemptResult.outcome === "run-fatal") {
				result.failed++;
				result.aborted = true;
				api?.statusPanel.addMessage("error", `Neptun reports there is no open course registration period. Stopped after the first subject; the remaining ${eligibleTargets.length - result.attempted} were not clicked. Console run: ${diagnostics.runId}.`);
				break;
			}
			if (attemptResult.outcome === "aborted") {
				result.failed++;
				result.aborted = true;
				api?.statusPanel.addMessage("error", `Neptun opened a registration confirmation. Complete or cancel it manually, enable “do not show again,” then retry. Remaining subjects were not clicked. Console run: ${diagnostics.runId}.`);
				break;
			}
			result.failed++;
		}
		const summary = `Planner enrollment: ${result.enrolled} enrolled, ${result.failed} failed, ${result.unconfirmed} unconfirmed, ${result.skipped} skipped.${result.aborted ? " Stopped safely." : ""}`;
		const summaryWithRunId = `${summary} Console run: ${diagnostics.runId}.`;
		diagnostics.log("enroll:complete", {
			enrolled: result.enrolled,
			failed: result.failed,
			unconfirmed: result.unconfirmed,
			skipped: result.skipped,
			aborted: result.aborted
		});
		api?.logger.info(summary, result);
		api?.statusPanel.addMessage(result.failed === 0 && result.unconfirmed === 0 && !result.aborted ? "info" : "warn", result.errors.length > 0 ? `${summaryWithRunId} ${result.errors.join("; ")}` : summaryWithRunId);
		return result;
	}
	function enrollPlannedCourses(options = {}) {
		if (plannerEnrollmentInFlight) return plannerEnrollmentInFlight;
		if (getIsEnrolling()) return Promise.resolve(emptyResult("Enrollment is already in progress"));
		setIsEnrolling(true);
		const run = runPlannerEnrollment(options);
		plannerEnrollmentInFlight = run;
		const clearInFlight = () => {
			if (plannerEnrollmentInFlight === run) plannerEnrollmentInFlight = null;
			setIsEnrolling(false);
		};
		run.then(clearInFlight, clearInFlight);
		return run;
	}
	var PREVIEW_STYLE_ID$1 = "npu-course-preview-style";
	var PREVIEW_ATTRIBUTE$1 = "data-npu-course-preview";
	var previewInFlight$1 = null;
	var plannerPreviewInFlight = null;
	function normalizeCode(code) {
		return code.replace(/\s+/g, "").toUpperCase();
	}
	function ensurePreviewStyle$1() {
		if (document.getElementById(PREVIEW_STYLE_ID$1)) return;
		const style = document.createElement("style");
		style.id = PREVIEW_STYLE_ID$1;
		style.textContent = `
    [${PREVIEW_ATTRIBUTE$1}="subject"] {
      outline: 2px solid #4f8cff !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE$1}="unavailable-subject"] {
      outline: 2px solid #d64545 !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE$1}="course"] {
      box-shadow: inset 4px 0 0 #4f8cff !important;
      background: rgba(79, 140, 255, 0.12) !important;
    }
    [${PREVIEW_ATTRIBUTE$1}="selected-course"] {
      box-shadow: inset 4px 0 0 #22a06b !important;
      background: rgba(34, 160, 107, 0.14) !important;
    }
    [${PREVIEW_ATTRIBUTE$1}="enrollment-button"] {
      outline: 3px solid #ffb020 !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE$1}="unavailable-enrollment-button"] {
      outline: 3px solid #d64545 !important;
      outline-offset: 2px !important;
    }
  `;
		document.head.appendChild(style);
	}
	function findEnrollmentButton(panel) {
		return Array.from(panel.querySelectorAll("button")).find((button) => isEnrollButtonText(button.textContent ?? "")) ?? null;
	}
	function clearCoursePreview() {
		document.querySelectorAll(`[${PREVIEW_ATTRIBUTE$1}]`).forEach((element) => {
			element.removeAttribute(PREVIEW_ATTRIBUTE$1);
		});
	}
	async function runCoursePreview() {
		const api = getApi$1();
		const selections = await loadSelections();
		const entries = Object.entries(selections);
		clearCoursePreview();
		ensurePreviewStyle$1();
		const result = {
			savedSubjects: entries.length,
			matchedSubjects: 0,
			savedCourses: Object.values(selections).reduce((sum, codes) => sum + codes.length, 0),
			matchedCourses: 0,
			selectedCourses: 0,
			enrollmentButtons: 0,
			availableEnrollmentButtons: 0,
			missing: []
		};
		if (entries.length === 0) {
			api?.statusPanel.addMessage("info", "No saved courses to preview. No course selections or enrollment buttons were clicked.");
			return result;
		}
		for (const [subjectCode, courseCodes] of entries) {
			const panel = findSubjectPanel(subjectCode);
			if (!panel) {
				result.missing.push(`${subjectCode}: subject not visible`);
				continue;
			}
			result.matchedSubjects++;
			panel.setAttribute(PREVIEW_ATTRIBUTE$1, "subject");
			if (!await expandPanel(panel)) {
				result.missing.push(`${subjectCode}: subject panel could not be expanded`);
				continue;
			}
			const livePanel = findSubjectPanel(subjectCode) ?? panel;
			livePanel.setAttribute(PREVIEW_ATTRIBUTE$1, "subject");
			const items = getCourseItems(livePanel);
			for (const courseCode of courseCodes) {
				const normalizedSavedCode = normalizeCode(courseCode);
				const item = items.find((candidate) => {
					const visibleCode = extractCourseCode(candidate);
					return visibleCode !== null && normalizeCode(visibleCode) === normalizedSavedCode;
				});
				if (!item) {
					result.missing.push(`${subjectCode}: ${courseCode} not visible`);
					continue;
				}
				result.matchedCourses++;
				if (isCourseSelected(item)) {
					result.selectedCourses++;
					item.setAttribute(PREVIEW_ATTRIBUTE$1, "selected-course");
				} else item.setAttribute(PREVIEW_ATTRIBUTE$1, "course");
			}
			const enrollmentButton = findEnrollmentButton(livePanel);
			if (!enrollmentButton) {
				result.missing.push(`${subjectCode}: enrollment button not visible`);
				continue;
			}
			result.enrollmentButtons++;
			if (isElementAvailable(enrollmentButton)) {
				result.availableEnrollmentButtons++;
				enrollmentButton.setAttribute(PREVIEW_ATTRIBUTE$1, "enrollment-button");
			} else {
				enrollmentButton.setAttribute(PREVIEW_ATTRIBUTE$1, "unavailable-enrollment-button");
				result.missing.push(`${subjectCode}: enrollment button unavailable`);
			}
		}
		api?.logger.info("course preview result", result);
		api?.statusPanel.addMessage(result.missing.length === 0 ? "info" : "warn", `Preview: ${result.matchedCourses}/${result.savedCourses} saved courses matched; ${result.availableEnrollmentButtons}/${result.enrollmentButtons} enrollment buttons available. No course selections or enrollment buttons were clicked.`);
		return result;
	}
	function previewSavedCourses() {
		if (previewInFlight$1) return previewInFlight$1;
		const run = runCoursePreview();
		previewInFlight$1 = run;
		const clearInFlight = () => {
			if (previewInFlight$1 === run) previewInFlight$1 = null;
		};
		run.then(clearInFlight, clearInFlight);
		return run;
	}
	async function runPlannerPreview() {
		const api = getApi$1();
		clearCoursePreview();
		ensurePreviewStyle$1();
		const diagnostics = createPlannerDiagnostics("preview");
		diagnostics.log("preview:start");
		const snapshot = await collectPlannerSnapshot({
			diagnostics,
			operation: "preview"
		});
		const result = {
			diagnosticRunId: snapshot.diagnosticRunId,
			contentReady: snapshot.contentReady,
			plannedSubjects: snapshot.subjects.length,
			plannedCourses: snapshot.subjects.reduce((sum, subject) => sum + subject.courseCodes.length, 0),
			enrollableSubjects: snapshot.subjects.filter((subject) => subject.available).length,
			unavailableSubjects: snapshot.subjects.filter((subject) => !subject.available).length,
			openedPlanner: snapshot.preparation.openedPlanner,
			switchedToList: snapshot.preparation.switchedToList,
			issues: snapshot.issues
		};
		for (const subject of snapshot.subjects) {
			subject.panel.setAttribute(PREVIEW_ATTRIBUTE$1, subject.available ? "subject" : "unavailable-subject");
			subject.selectedCourseItems.forEach((item) => {
				item.setAttribute(PREVIEW_ATTRIBUTE$1, "selected-course");
			});
			if (subject.enrollmentButton) subject.enrollmentButton.setAttribute(PREVIEW_ATTRIBUTE$1, subject.available ? "enrollment-button" : "unavailable-enrollment-button");
		}
		api?.logger.info("planner preview result", result);
		diagnostics.log("preview:complete", {
			contentReady: result.contentReady,
			plannedSubjects: result.plannedSubjects,
			plannedCourses: result.plannedCourses,
			enrollableSubjects: result.enrollableSubjects,
			issueCount: result.issues.length
		});
		if (!result.contentReady) {
			api?.statusPanel.addMessage("warn", `Planner preview could not read a fully loaded subject list: ${result.issues.join("; ")}. No course, planner-selection, or enrollment controls were clicked. Console run: ${result.diagnosticRunId}.`);
			return result;
		}
		api?.statusPanel.addMessage(result.issues.length === 0 ? "info" : "warn", `Planner preview: ${result.enrollableSubjects}/${result.plannedSubjects} subjects ready; ${result.plannedCourses} planned courses found. Only planner view controls and subject headers may have been opened. No course, planner-selection, or enrollment controls were clicked. Console run: ${result.diagnosticRunId}.`);
		return result;
	}
	function previewPlannedCourses() {
		if (plannerPreviewInFlight) return plannerPreviewInFlight;
		const run = runPlannerPreview();
		plannerPreviewInFlight = run;
		const clearInFlight = () => {
			if (plannerPreviewInFlight === run) plannerPreviewInFlight = null;
		};
		run.then(clearInFlight, clearInFlight);
		return run;
	}
	var COURSE_UI_BUILD = "3.4.0 planner-first";
	async function renderModuleUI$1() {
		const api = getApi$1();
		if (!api) return;
		clearCoursePreview();
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
		const plannerPreviewBtn = document.createElement("button");
		plannerPreviewBtn.style.cssText = `${btnStyle} background: #37474f; color: white;`;
		plannerPreviewBtn.textContent = "Preview Planner";
		plannerPreviewBtn.title = "Open Neptun timetable planner list view and highlight its exact planned courses without changing selections or enrolling";
		plannerPreviewBtn.addEventListener("click", () => {
			previewPlannedCourses().catch((err) => api?.logger.error("planner preview failed:", err));
		});
		btnContainer.appendChild(plannerPreviewBtn);
		const plannerEnrollBtn = document.createElement("button");
		plannerEnrollBtn.style.cssText = `${btnStyle} background: #d84315; color: white; font-weight: bold;`;
		plannerEnrollBtn.textContent = "Enroll Planner";
		plannerEnrollBtn.title = "Immediately revalidate the exact timetable-planner courses, then click every valid visible enrollment button sequentially";
		plannerEnrollBtn.addEventListener("click", () => {
			if (getIsEnrolling()) return;
			enrollPlannedCourses().catch((err) => api?.logger.error("planner enrollment failed:", err));
		});
		btnContainer.appendChild(plannerEnrollBtn);
		const clearPreviewBtn = document.createElement("button");
		clearPreviewBtn.style.cssText = `${btnStyle} background: #455a64; color: white;`;
		clearPreviewBtn.textContent = "Clear Preview";
		clearPreviewBtn.addEventListener("click", () => {
			clearCoursePreview();
			api.statusPanel.addMessage("info", "Course preview cleared.");
		});
		btnContainer.appendChild(clearPreviewBtn);
		const saveBtn = document.createElement("button");
		saveBtn.style.cssText = `${btnStyle} background: #1565c0; color: white;`;
		saveBtn.textContent = "Save Local";
		saveBtn.title = "Save selections from the currently loaded subject list as a local fallback";
		saveBtn.addEventListener("click", () => {
			saveCurrentSelections().catch((err) => api?.logger.error("save selections failed:", err));
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
					removeSingleSubject(subj).then(() => renderModuleUI$1()).catch((err) => api?.logger.error("remove subject failed:", err));
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
				loadStoredSelections().catch((err) => api?.logger.error("load selections failed:", err));
			});
			btnContainer.appendChild(loadBtn);
			const previewBtn = document.createElement("button");
			previewBtn.style.cssText = `${btnStyle} background: #37474f; color: white;`;
			previewBtn.textContent = "Preview Saved";
			previewBtn.title = "Expand saved subjects and highlight matches without clicking course or enrollment controls";
			previewBtn.addEventListener("click", () => {
				previewSavedCourses().catch((err) => api?.logger.error("course preview failed:", err));
			});
			btnContainer.appendChild(previewBtn);
			const loadEnrollBtn = document.createElement("button");
			loadEnrollBtn.style.cssText = `${btnStyle} background: #ad451e; color: white;`;
			loadEnrollBtn.textContent = "Local Load + Enroll";
			loadEnrollBtn.title = "Fallback: load locally saved courses from the subject list, then enroll each subject";
			loadEnrollBtn.addEventListener("click", () => {
				if (getIsEnrolling()) return;
				loadAndEnroll().catch((err) => api?.logger.error("load & enroll failed:", err));
			});
			btnContainer.appendChild(loadEnrollBtn);
			const enrollBtn = document.createElement("button");
			enrollBtn.style.cssText = `${btnStyle} background: #e65100; color: white;`;
			enrollBtn.textContent = "Enroll Selected";
			enrollBtn.title = "Enroll subjects with courses already selected";
			enrollBtn.addEventListener("click", () => {
				if (getIsEnrolling()) return;
				quickEnrollAll().catch((err) => api?.logger.error("quick enroll failed:", err));
			});
			btnContainer.appendChild(enrollBtn);
			const clearBtn = document.createElement("button");
			clearBtn.style.cssText = `${btnStyle} background: #c62828; color: white;`;
			clearBtn.textContent = "Clear Saved";
			clearBtn.addEventListener("click", () => {
				handleClear().catch((err) => api?.logger.error("clear selections failed:", err));
			});
			btnContainer.appendChild(clearBtn);
		}
		container.appendChild(btnContainer);
		const hint = document.createElement("div");
		hint.style.cssText = "margin-top: 6px; font-size: 10px; color: #6a7a8a;";
		hint.textContent = "Primary workflow: put exact courses in Neptun’s timetable planner, then Preview Planner. Enroll Planner starts immediately, never changes planner/course selections, and continues through every still-valid subject. Disable Neptun’s own registration popup first. Privacy-safe diagnostics are always logged under [NPU:planner]. Local buttons are the fallback.";
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
		api.statusPanel.setModuleContentElement(container);
	}
	async function handleClear() {
		const api = getApi$1();
		await clearSelections();
		clearCoursePreview();
		api?.logger.info("cleared all stored course selections");
		api?.statusPanel.addMessage("info", "All stored selections cleared.");
		await renderModuleUI$1();
	}
	async function runLocalSavedRushFallback(api) {
		api.statusPanel.addMessage("info", "Neptun timetable planner is empty. Trying locally saved courses as the fallback...");
		const autoSearchResult = await autoSearchSubjects();
		let panelCount = getSubjectPanels().length;
		if (panelCount === 0) {
			const listingResult = await waitForSubjectListing({
				timeoutMs: PLANNER_TIMING.rushReadinessTimeoutMs,
				searchStartedAtMs: autoSearchResult.searchStartedAtMs ?? performance.now(),
				allowAutoClick: !autoSearchResult.clickedSearchButton
			});
			panelCount = listingResult.panels;
			if (panelCount === 0) {
				if (listingResult.state === "request-failed" && listingResult.requestStatus !== null) {
					api.logger.warn(`Rush Mode: subject search failed with status ${listingResult.requestStatus}`);
					api.statusPanel.addMessage("warn", `Subject search failed (${listingResult.requestStatus}). Registration may not be open yet.`);
				} else if (listingResult.state === "request-completed-no-panels") {
					api.logger.warn("Rush Mode: subject search completed but no subjects were listed");
					api.statusPanel.addMessage("warn", "Subject search completed, but no subjects were listed. Check filters or registration availability.");
				} else {
					api.logger.warn("Rush Mode: timed out waiting for subject listing - cannot auto-enroll");
					api.statusPanel.addMessage("warn", "Timed out waiting for subjects to load. Try refreshing and enabling Rush Mode again.");
				}
				return;
			}
		}
		await loadAndEnroll();
	}
	var savedChoicesUnsub$1 = null;
	var courseStoreModule = {
		id: "course-store",
		name: "Course Store",
		description: "Save course selections and restore them later",
		shouldActivate(context) {
			return context.path.includes("/subjects/registration");
		},
		async initialize(moduleApi) {
			setApi$1(moduleApi);
			const api = moduleApi;
			await renderModuleUI$1();
			savedChoicesUnsub$1?.();
			savedChoicesUnsub$1 = api.bus.on("saved-choices:restored", () => {
				renderModuleUI$1().catch((err) => api.logger.error("failed to refresh restored choices:", err));
			});
			const selections = await loadSelections();
			const count = Object.keys(selections).length;
			if (count > 0) {
				const courseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);
				api.statusPanel.addMessage("info", `${count} saved subject${count === 1 ? "" : "s"}, ${courseCount} course${courseCount === 1 ? "" : "s"}. Use Load to restore.`);
				api.logger.info(`found ${count} stored subject selection(s)`);
			}
			setRouteUnsub(api.bus.on("page:changed", (payload) => {
				if (payload.path.includes("/subjects/registration")) {
					if (!getApi$1()) return;
					renderModuleUI$1().then(async () => {
						const freshApi = getApi$1();
						if (!freshApi) return;
						const sel = await loadSelections();
						const storedSubjects = Object.keys(sel).length;
						if (storedSubjects > 0) {
							const storedCourses = Object.values(sel).reduce((sum, arr) => sum + arr.length, 0);
							freshApi.statusPanel.addMessage("info", `${storedSubjects} saved subject${storedSubjects === 1 ? "" : "s"}, ${storedCourses} course${storedCourses === 1 ? "" : "s"}. Use Load to restore.`);
						}
					}).catch((err) => {
						(getApi$1()?.logger ?? console).error("error in route change handler:", err);
					});
				}
			}));
			if (api.statusPanel.getCourseRushMode()) {
				api.logger.info("Course Rush Mode active - using Neptun timetable planner first");
				await api.statusPanel.setCourseRushMode(false);
				api.statusPanel.addMessage("info", "Course Rush started and turned itself off. Waiting for Neptun timetable planner...");
				const plannerResult = await enrollPlannedCourses({ plannerWaitTimeoutMs: PLANNER_TIMING.rushReadinessTimeoutMs });
				if (!plannerResult.plannerReady) api.statusPanel.addMessage("warn", "Neptun timetable planner did not become ready. Local fallback was not started automatically; nothing else was clicked.");
				else if (plannerResult.listedSubjects === 0 && plannerResult.plannedSubjects === 0 && plannerResult.attempted === 0 && !plannerResult.aborted) {
					const rushSelections = await loadSelections();
					if (Object.keys(rushSelections).length > 0) {
						if (plannerResult.openedPlanner && closePlannerSafely()) await runLocalSavedRushFallback(api);
						else {
							api.logger.warn("Rush Mode: planner was already open and empty; local fallback was not started automatically");
							api.statusPanel.addMessage("warn", "Planner is empty, but it was already open. Close it and use Local Load + Enroll for the saved fallback.");
						}
					} else api.statusPanel.addMessage("warn", "No planned subjects or locally saved fallback courses were found. Nothing was clicked.");
				}
			} else await autoSearchSubjects();
			api.logger.info("initialized on registration page");
		},
		dispose() {
			setIsEnrolling(false);
			clearCoursePreview();
			savedChoicesUnsub$1?.();
			savedChoicesUnsub$1 = null;
			getRouteUnsub()?.();
			setRouteUnsub(null);
			setApi$1(null);
		}
	};
	var STORAGE_KEY$1 = "examPreferences";
	var HIGHLIGHT_STYLE = "background-color: rgba(76, 175, 80, 0.15) !important; border-left: 3px solid #4caf50 !important;";
	var api$1 = null;
	var tableObserver = null;
	var debounceTimer = null;
	var isDisposed = false;
	var isEnrollmentInProgress = false;
	var cachedSubjectCode = void 0;
	function getApi() {
		return api$1;
	}
	function setApi(value) {
		api$1 = value;
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
	function getIsEnrollmentInProgress() {
		return isEnrollmentInProgress;
	}
	function setIsEnrollmentInProgress(value) {
		isEnrollmentInProgress = value;
	}
	function getCachedSubjectCode() {
		return cachedSubjectCode;
	}
	function setCachedSubjectCode(value) {
		cachedSubjectCode = value;
	}
	var HUNGARIAN_MONTHS = {
		januar: 1,
		februar: 2,
		marcius: 3,
		aprilis: 4,
		majus: 5,
		junius: 6,
		julius: 7,
		augusztus: 8,
		szeptember: 9,
		oktober: 10,
		november: 11,
		december: 12
	};
	var HUNGARIAN_DATE_RE = /(\d{4})\.\s*([A-Za-z\u00c0-\u017f]+)\s+(\d{1,2})\.\s*(\d{1,2}):(\d{2})/i;
	var NUMERIC_DATE_RE = /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?\s+(\d{1,2}):(\d{2})/;
	function pad2(value) {
		return value < 10 ? `0${value}` : `${value}`;
	}
	function normalizeMonthName(value) {
		return value.toLocaleLowerCase("hu-HU").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
	}
	function buildParsedDate(raw, year, month, dayOfMonth, hour, minute) {
		if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(dayOfMonth) || !Number.isInteger(hour) || !Number.isInteger(minute) || month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
		return {
			raw: raw.replace(/\s+/g, " ").trim(),
			day: `${year}-${pad2(month)}-${pad2(dayOfMonth)}`,
			time: `${pad2(hour)}:${pad2(minute)}`,
			year,
			month,
			dayOfMonth
		};
	}
	function extractExamDateText(text) {
		const normalizedText = text.replace(/\s+/g, " ").trim();
		return (normalizedText.match(HUNGARIAN_DATE_RE) ?? normalizedText.match(NUMERIC_DATE_RE))?.[0].replace(/\s+/g, " ").trim() ?? null;
	}
	function parseExamDateText(text) {
		const normalizedText = text.replace(/\s+/g, " ").trim();
		const hungarianMatch = normalizedText.match(HUNGARIAN_DATE_RE);
		if (hungarianMatch) {
			const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = hungarianMatch;
			const month = HUNGARIAN_MONTHS[normalizeMonthName(rawMonth)];
			if (!month) return null;
			return buildParsedDate(hungarianMatch[0], Number(rawYear), month, Number(rawDay), Number(rawHour), Number(rawMinute));
		}
		const numericMatch = normalizedText.match(NUMERIC_DATE_RE);
		if (!numericMatch) return null;
		const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = numericMatch;
		return buildParsedDate(numericMatch[0], Number(rawYear), Number(rawMonth), Number(rawDay), Number(rawHour), Number(rawMinute));
	}
	function getSubjectCodeFromElements(elements) {
		for (const element of elements) {
			const code = extractSubjectCodeFromText(element?.textContent ?? "");
			if (code) return code;
		}
		return null;
	}
	function getStableOwnText(element) {
		return Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
	}
	function getStandaloneSubjectCode(element) {
		if (![
			"P",
			"DIV",
			"SPAN",
			"H1",
			"H2",
			"H3",
			"H4",
			"H5",
			"H6"
		].includes(element.tagName)) return null;
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
		return Array.from(row.querySelectorAll("button")).find((button) => {
			return (button.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase().includes("felv");
		}) ?? null;
	}
	function normalizeStatusText(text) {
		return text.toLocaleLowerCase("hu-HU").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
	}
	function getButtonTexts(root) {
		if (!root) return [];
		return Array.from(root.querySelectorAll("button")).map((button) => normalizeStatusText(button.textContent ?? "").trim()).filter(Boolean);
	}
	function getRegistrationState(cells, cellTexts, date, felvetelBtn) {
		const dateCellStatusText = normalizeStatusText((cellTexts[0] ?? "").replace(date, " "));
		const actionButtonTexts = getButtonTexts(cells[cells.length - 1]);
		if (dateCellStatusText.includes("felveve") || actionButtonTexts.some((text) => text === "leadas")) return "registered";
		if (dateCellStatusText.includes("betelt")) return "full";
		if (dateCellStatusText.includes("varolistas")) return "waitlistOnly";
		if (felvetelBtn) return "available";
		return "unknown";
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
			if (code) currentCode = code;
			else if (currentNode.tagName === "TABLE" && currentCode) map.set(currentNode, currentCode);
			currentNode = walker.nextNode();
		}
		return map;
	}
	function getSubjectCodeForTable(table, tableSubjectCodes = buildTableSubjectCodeMap()) {
		if (!table) return null;
		return tableSubjectCodes.get(table) ?? null;
	}
	function getRowSubjectCode(row, tableSubjectCodes = buildTableSubjectCodeMap()) {
		return getSubjectCodeForTable(row.closest("table"), tableSubjectCodes);
	}
	function getPageSubjectCodes() {
		const uniqueCodes = new Set();
		const tableSubjectCodes = buildTableSubjectCodeMap();
		for (const code of tableSubjectCodes.values()) uniqueCodes.add(code);
		return Array.from(uniqueCodes);
	}
	function getSubjectCode() {
		const api = getApi();
		const cached = getCachedSubjectCode();
		if (cached !== void 0) {
			api?.logger.info(`[exam-dom-debug] getSubjectCode: returning cached="${cached}"`);
			return cached;
		}
		try {
			const code = extractSubjectCodeFromText(new URLSearchParams(window.location.search).get("subjectName") ?? "");
			if (code) {
				api?.logger.info(`[exam-dom-debug] getSubjectCode: found via URL param, code="${code}"`);
				setCachedSubjectCode(code);
				return code;
			}
		} catch {}
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
				api?.logger.info(`[exam-dom-debug] getSubjectCode: found near heading, code="${code}"`);
				setCachedSubjectCode(code);
				return code;
			}
		}
		const pageSubjectCodes = getPageSubjectCodes();
		if (pageSubjectCodes.length === 1) {
			api?.logger.info(`[exam-dom-debug] getSubjectCode: found single page subject code="${pageSubjectCodes[0]}"`);
			setCachedSubjectCode(pageSubjectCodes[0]);
			return pageSubjectCodes[0];
		}
		if (pageSubjectCodes.length > 1) api?.logger.info("[exam-dom-debug] getSubjectCode: multiple subject tables detected, no single page subject code");
		api?.logger.warn("[exam-dom-debug] getSubjectCode: no subject code found on page");
		setCachedSubjectCode(null);
		return null;
	}
	function getSubjectName() {
		return document.querySelector("h1")?.textContent?.trim() ?? null;
	}
	function getExamRows() {
		return Array.from(document.querySelectorAll("table tr")).filter((row) => {
			if (row.querySelectorAll("td").length < 4) return false;
			return !!row.querySelector("button");
		});
	}
	function parseExamRow(row) {
		const api = getApi();
		const cells = Array.from(row.querySelectorAll("td"));
		const felvetelBtn = getEnrollmentButton(row);
		if (cells.length < 4) api?.logger.warn(`[exam-dom-debug] parseExamRow: only ${cells.length} cells, expected 4+`);
		const cellTexts = cells.map((c) => getCellText(c));
		const isCompactLayout = cells.length === 4;
		const date = extractExamDateText(cellTexts[0] ?? "") ?? cellTexts[0] ?? "";
		const type = cellTexts[1] ?? "";
		const capacity = cellTexts[2] ?? "";
		const instructor = isCompactLayout ? "" : cellTexts[3] ?? "";
		const courseCode = isCompactLayout ? "" : cellTexts[4] ?? "";
		const registrationState = getRegistrationState(cells, cellTexts, date, felvetelBtn);
		if (!felvetelBtn && registrationState === "unknown") api?.logger.warn("[exam-dom-debug] parseExamRow: action button not found on row");
		return {
			row,
			date,
			type,
			capacity,
			instructor,
			courseCode,
			registrationState,
			felvetelBtn
		};
	}
	function addSaveButtonsToRows(subjectCode, onSave) {
		const api = getApi();
		document.querySelectorAll(".npu-exam-save-btn").forEach((b) => b.remove());
		document.querySelectorAll(".npu-exam-save-slot").forEach((slot) => slot.remove());
		const tableSubjectCodes = buildTableSubjectCodeMap();
		const rows = getExamRows();
		api?.logger.info(`[exam-dom-debug] addSaveButtonsToRows: processing ${rows.length} exam rows for ${subjectCode}`);
		let addedCount = 0;
		for (const row of rows) {
			const info = parseExamRow(row);
			const resolvedSubjectCode = getSubjectCodeForTable(row.closest("table"), tableSubjectCodes) ?? subjectCode;
			if (!resolvedSubjectCode) {
				api?.logger.warn(`[exam-dom-debug] addSaveButtonsToRows: no subjectCode resolved for row date="${info.date}"`);
				continue;
			}
			const firstCell = row.querySelector("td");
			if (!firstCell) {
				api?.logger.warn(`[exam-dom-debug] addSaveButtonsToRows: firstCell not found for row date="${info.date}"`);
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
		api?.logger.info(`[exam-dom-debug] addSaveButtonsToRows: added ${addedCount} save buttons`);
		return {
			addedCount,
			rowCount: rows.length
		};
	}
	function isOwnInjectedNode(node) {
		if (node instanceof Element) {
			if (node.closest("#npu-status-root")) return true;
			if (node.classList.contains("npu-exam-save-slot") || node.closest(".npu-exam-save-slot")) return true;
			if (node.classList.contains("npu-exam-save-btn") || node.closest(".npu-exam-save-btn")) return true;
			return false;
		}
		return !!node.parentElement?.closest("#npu-status-root, .npu-exam-save-slot, .npu-exam-save-btn");
	}
	function scheduleSaveButtonRefresh(subjectCode, onSave, delayMs) {
		const currentTimer = getDebounceTimer();
		if (currentTimer) clearTimeout(currentTimer);
		setDebounceTimer(setTimeout(() => {
			setDebounceTimer(null);
			if (getIsDisposed()) return;
			if (getIsEnrollmentInProgress()) {
				scheduleSaveButtonRefresh(subjectCode, onSave, 500);
				return;
			}
			addSaveButtonsToRows(subjectCode, onSave);
		}, delayMs));
	}
	function watchTableForReRenders(subjectCode, onSave) {
		const api = getApi();
		getTableObserver()?.disconnect();
		const timer = getDebounceTimer();
		if (timer) {
			clearTimeout(timer);
			setDebounceTimer(null);
		}
		const observerTarget = document.querySelector("main") ?? document.body;
		if (!observerTarget) {
			api?.logger.info("[exam-dom-debug] watchTableForReRenders: skipping, no observer target");
			return;
		}
		const newObserver = new MutationObserver((mutations) => {
			if (getIsDisposed()) return;
			if (!mutations.some((mutation) => {
				if (isOwnInjectedNode(mutation.target)) return false;
				const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
				if (changedNodes.length === 0) return false;
				return changedNodes.some((node) => {
					if (isOwnInjectedNode(node)) return false;
					return true;
				});
			})) return;
			scheduleSaveButtonRefresh(subjectCode, onSave, getIsEnrollmentInProgress() ? 500 : 300);
		});
		newObserver.observe(observerTarget, {
			childList: true,
			subtree: true
		});
		setTableObserver(newObserver);
		api?.logger.info("[exam-dom-debug] watchTableForReRenders: MutationObserver attached to page container");
	}
	function highlightSavedRow(pref) {
		clearHighlights();
		const rows = getExamRows();
		for (const row of rows) if (parseExamRow(row).date === pref.date) {
			row.setAttribute("style", HIGHLIGHT_STYLE);
			row.setAttribute("data-npu-highlighted", "true");
		}
	}
	function clearHighlights() {
		document.querySelectorAll("[data-npu-highlighted]").forEach((el) => {
			el.removeAttribute("style");
			el.removeAttribute("data-npu-highlighted");
		});
	}
	async function loadPreferences() {
		const api = getApi();
		if (!api) return {};
		const raw = await api.storage.getForDomain("examPreferences") ?? {};
		const valid = {};
		for (const [code, pref] of Object.entries(raw)) if (pref && typeof pref.date === "string" && pref.date.length > 0) valid[code] = {
			...pref,
			date: extractExamDateText(pref.date) ?? pref.date
		};
		return valid;
	}
	async function savePreferences(prefs) {
		const api = getApi();
		if (!api) return;
		await api.storage.setForDomain(STORAGE_KEY$1, prefs);
	}
	var CONFIRM_BUTTON_WAIT_MS = 5e3;
	var CONFIRM_BUTTON_POLL_MS = 50;
	var EXAM_TABLE_WAIT_POLL_MS = 300;
	var SAVED_TARGET_WAIT_MS = 15e3;
	var SAVED_TARGET_POLL_MS = 300;
	function isCurrentEnrollmentRun(apiRef) {
		return !getIsDisposed() && getApi() === apiRef;
	}
	function resolveCurrentTargetInfo(target) {
		const tableSubjectCodes = buildTableSubjectCodeMap();
		for (const row of getExamRows()) {
			if (getRowSubjectCode(row, tableSubjectCodes) !== target.subjectCode) continue;
			const info = parseExamRow(row);
			if (info.date !== target.pref.date) continue;
			return info;
		}
		return null;
	}
	function getLatestNotificationSummary() {
		return Array.from(document.querySelectorAll("body *")).map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()).filter((text) => text.length > 0 && text.length < 220 && /siker|sikertelen|hiba|nem enged[ée]lyezett|vizsgajelentkez/i.test(text))[0] ?? null;
	}
	function findSavedExamTargets(prefs) {
		const targets = [];
		const tableSubjectCodes = buildTableSubjectCodeMap();
		for (const row of getExamRows()) {
			const subjectCode = getRowSubjectCode(row, tableSubjectCodes);
			if (!subjectCode) continue;
			const pref = prefs[subjectCode];
			if (!pref) continue;
			if (parseExamRow(row).date !== pref.date) continue;
			targets.push({
				subjectCode,
				pref
			});
		}
		return targets;
	}
	async function waitForSavedExamTargets(prefs, timeoutMs = SAVED_TARGET_WAIT_MS) {
		const api = getApi();
		const start = Date.now();
		let pollCount = 0;
		while (Date.now() - start < timeoutMs) {
			if (getIsDisposed()) return [];
			const targets = findSavedExamTargets(prefs);
			if (targets.length > 0) {
				api?.logger.info(`[exam-enroll-debug] waitForSavedExamTargets: found ${targets.length} target(s) after ${pollCount} polls (${Date.now() - start}ms)`);
				return targets;
			}
			pollCount++;
			await delay(SAVED_TARGET_POLL_MS);
		}
		const targets = findSavedExamTargets(prefs);
		if (targets.length > 0) {
			api?.logger.info(`[exam-enroll-debug] waitForSavedExamTargets: found ${targets.length} target(s) on final check (${Date.now() - start}ms)`);
			return targets;
		}
		api?.logger.info(`[exam-enroll-debug] waitForSavedExamTargets: no saved targets after ${pollCount} polls (${timeoutMs}ms)`);
		return [];
	}
	function hasSessionToken() {
		const api = getApi();
		try {
			if (!sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)) {
				api?.logger.warn("no access_token in sessionStorage - session may have expired");
				api?.statusPanel.addMessage("error", "Session expired. Log in again before enrolling.");
				return false;
			}
		} catch (err) {
			api?.logger.warn("cannot check sessionStorage for access_token:", err);
		}
		return true;
	}
	function normalizeButtonText(text) {
		return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
	}
	function isConfirmButtonText(text) {
		const normalized = normalizeButtonText(text);
		return normalized.includes("megerosit") || normalized.includes("confirm") || normalized === "igen" || normalized === "ok";
	}
	function isExamConfirmationDialogText(text) {
		const normalized = normalizeButtonText(text);
		const mentionsExam = normalized.includes("vizsga") || normalized.includes("exam");
		const mentionsEnrollment = normalized.includes("jelentkez") || normalized.includes("felvetel") || normalized.includes("registration") || normalized.includes("sign up") || normalized.includes("enroll");
		return mentionsExam && mentionsEnrollment;
	}
	function isButtonInteractable(button) {
		if (!button.isConnected) return false;
		if (button.hasAttribute("disabled")) return false;
		const htmlButton = button;
		if (typeof htmlButton.disabled === "boolean" && htmlButton.disabled) return false;
		if (button.getAttribute("aria-disabled") === "true") return false;
		const style = window.getComputedStyle(button);
		return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
	}
	function findConfirmButtonElement() {
		const overlays = Array.from(document.querySelectorAll(".cdk-overlay-container"));
		if (overlays.length === 0) return null;
		return overlays.flatMap((overlay) => Array.from(overlay.querySelectorAll("button"))).find((button) => {
			if (!isConfirmButtonText(button.textContent ?? "") || !isButtonInteractable(button)) return false;
			return isExamConfirmationDialogText(button.closest(".cdk-overlay-pane, .mat-mdc-dialog-container")?.textContent ?? button.parentElement?.textContent ?? "");
		}) ?? null;
	}
	function waitForConfirmButton(timeoutMs = CONFIRM_BUTTON_WAIT_MS, stopWhen) {
		return new Promise((resolve) => {
			let settled = false;
			let observer = null;
			let pollTimer = null;
			let timeoutTimer = null;
			function cleanup() {
				observer?.disconnect();
				if (pollTimer) clearInterval(pollTimer);
				if (timeoutTimer) clearTimeout(timeoutTimer);
			}
			function settle(button) {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(button);
			}
			function check() {
				const button = findConfirmButtonElement();
				if (button) settle(button);
			}
			check();
			if (settled) return;
			const observerTarget = document.body ?? document.documentElement;
			if (observerTarget) {
				observer = new MutationObserver(check);
				observer.observe(observerTarget, {
					attributes: true,
					childList: true,
					subtree: true
				});
			}
			pollTimer = setInterval(check, CONFIRM_BUTTON_POLL_MS);
			timeoutTimer = setTimeout(() => settle(null), timeoutMs);
			stopWhen?.then(() => settle(null), () => settle(null));
		});
	}
	async function submitEnrollmentTarget(target) {
		const api = getApi();
		const { subjectCode, pref } = target;
		const info = resolveCurrentTargetInfo(target);
		if (!info) {
			api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: live row not found for ${subjectCode} ${pref.date}`);
			api?.statusPanel.addMessage("warn", `${subjectCode}: saved exam row is not visible.`);
			return {
				failed: true,
				submitted: false,
				shouldStop: false
			};
		}
		if (!info.felvetelBtn) {
			api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: button not found for ${subjectCode} ${pref.date}`);
			api?.statusPanel.addMessage("warn", `${subjectCode}: enrollment button is missing.`);
			return {
				failed: true,
				submitted: false,
				shouldStop: false
			};
		}
		if (!info.felvetelBtn.isConnected) {
			api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: button became detached for ${subjectCode} ${pref.date}`);
			api?.statusPanel.addMessage("warn", `${subjectCode}: enrollment button changed before click.`);
			return {
				failed: true,
				submitted: false,
				shouldStop: false
			};
		}
		if (info.felvetelBtn.disabled || info.felvetelBtn.hasAttribute("disabled")) {
			api?.logger.info(`[exam-enroll-debug] submitEnrollmentTarget: button disabled for ${subjectCode}`);
			api?.statusPanel.addMessage("warn", `${subjectCode}: registration button is disabled.`);
			return {
				failed: true,
				submitted: false,
				shouldStop: false
			};
		}
		const capacityMatch = /(\d+)\s*\/\s*(\d+)/.exec(info.capacity);
		if (capacityMatch) {
			const current = parseInt(capacityMatch[1], 10);
			const limit = parseInt(capacityMatch[2], 10);
			api?.logger.info(`[exam-enroll-debug] submitEnrollmentTarget: ${subjectCode} capacity ${current}/${limit}`);
			if (current >= limit) {
				api?.statusPanel.addMessage("warn", `${subjectCode}: saved exam is full (${current}/${limit}).`);
				return {
					failed: true,
					submitted: false,
					shouldStop: false
				};
			}
		}
		api?.logger.info(`[exam-enroll-debug] submitEnrollmentTarget: clicking Felvétel for ${subjectCode} ${pref.date}`);
		api?.statusPanel.addMessage("info", `Auto-enrolling ${subjectCode}: ${pref.date}...`);
		api?.statusPanel.expand();
		const requestPromise = waitForRequestComplete("ExamRegistration/SignUpForExam", 3e4, performance.now());
		info.felvetelBtn.click();
		if (isCurrentEnrollmentRun(api)) {
			const confirmBtn = await waitForConfirmButton(CONFIRM_BUTTON_WAIT_MS, requestPromise);
			if (confirmBtn) {
				api?.logger.info("[exam-enroll-debug] dialog found, confirming");
				confirmBtn.click();
			} else api?.logger.info("[exam-enroll-debug] no dialog - enrollment submitted directly or confirmation did not appear");
		}
		if (!isCurrentEnrollmentRun(api)) return {
			failed: false,
			submitted: false,
			shouldStop: true
		};
		const requestResult = await requestPromise;
		if (!isCurrentEnrollmentRun(api)) return {
			failed: false,
			submitted: false,
			shouldStop: true
		};
		if (!requestResult.completed) {
			api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: no server response for ${subjectCode}`);
			api?.statusPanel.addMessage("warn", `${subjectCode}: no server response after clicking Felvétel.`);
			return {
				failed: true,
				submitted: false,
				shouldStop: false
			};
		}
		if (requestResult.status !== null && requestResult.status >= 400) {
			const notificationSummary = getLatestNotificationSummary();
			api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: request failed for ${subjectCode} with status=${requestResult.status}`);
			api?.statusPanel.addMessage("warn", notificationSummary ? `${subjectCode}: ${notificationSummary}` : `${subjectCode}: server returned ${requestResult.status}.`);
			return {
				failed: true,
				submitted: false,
				shouldStop: false
			};
		}
		api?.statusPanel.addMessage("info", `Enrollment submitted for ${subjectCode}: ${pref.date}.`);
		return {
			failed: false,
			submitted: true,
			shouldStop: false
		};
	}
	async function autoEnrollSaved() {
		const api = getApi();
		if (getIsEnrollmentInProgress()) {
			api?.logger.warn("[exam-enroll-debug] autoEnrollSaved: enrollment already in progress");
			return;
		}
		if (!hasSessionToken()) return;
		setIsEnrollmentInProgress(true);
		try {
			const prefs = await loadPreferences();
			if (Object.keys(prefs).length === 0) {
				api?.logger.info("[exam-enroll-debug] autoEnrollSaved: no saved preferences found");
				api?.statusPanel.addMessage("info", "No saved exam dates found.");
				return;
			}
			const pageSubjectCode = getSubjectCode();
			let targets = findSavedExamTargets(prefs);
			api?.logger.info(`[exam-enroll-debug] autoEnrollSaved: found ${targets.length} saved targets on the current page`);
			const mayStillRenderSavedTarget = Object.keys(prefs).length > 0 && (pageSubjectCode === null || Boolean(prefs[pageSubjectCode]));
			if (targets.length === 0 && mayStillRenderSavedTarget) {
				api?.statusPanel.addMessage("info", "Waiting for saved exam rows to finish loading...");
				targets = await waitForSavedExamTargets(prefs);
				if (!isCurrentEnrollmentRun(api)) return;
			}
			if (targets.length === 0) {
				if (pageSubjectCode && prefs[pageSubjectCode]) {
					api?.logger.warn(`[exam-enroll-debug] autoEnrollSaved: saved exam date "${prefs[pageSubjectCode].date}" not found on current page`);
					api?.statusPanel.addMessage("warn", `Saved exam date "${prefs[pageSubjectCode].date}" not found on this page.`);
				} else {
					api?.logger.info("[exam-enroll-debug] autoEnrollSaved: no saved exam targets visible on this page");
					api?.statusPanel.addMessage("info", "No saved exam dates are visible on this page.");
				}
				showRetryButton();
				return;
			}
			api?.statusPanel.addMessage("info", `Exam Rush: ${targets.length} saved target${targets.length === 1 ? "" : "s"} visible.`);
			await api?.statusPanel.setExamRushMode(false);
			api?.statusPanel.addMessage("info", "Exam Rush started and turned itself off.");
			let failedCount = 0;
			let submittedCount = 0;
			let stoppedEarly = false;
			for (const target of targets) {
				if (!isCurrentEnrollmentRun(api)) break;
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
			if (!isCurrentEnrollmentRun(api)) return;
			if (submittedCount === 0 && failedCount === 0) {
				api?.statusPanel.addMessage("warn", "Exam Rush did not submit any visible saved exams.");
				showRetryButton();
			} else if (stoppedEarly) api?.statusPanel.addMessage("warn", `Exam Rush stopped early: ${submittedCount} submitted, ${failedCount} failed.`);
			else if (failedCount > 0) api?.statusPanel.addMessage("warn", `Exam Rush finished: ${submittedCount} submitted, ${failedCount} failed.`);
			else api?.statusPanel.addMessage("info", `Exam Rush submitted ${submittedCount} saved exam${submittedCount === 1 ? "" : "s"}.`);
		} finally {
			setIsEnrollmentInProgress(false);
		}
	}
	function showRetryButton() {
		const api = getApi();
		if (!api) return;
		document.querySelector(".npu-exam-retry-btn")?.remove();
		const retryBtn = document.createElement("button");
		retryBtn.className = "npu-exam-retry-btn";
		retryBtn.style.cssText = "padding: 4px 12px; background: #e65100; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold; margin-top: 4px; display: block;";
		retryBtn.textContent = "Retry Enrollment";
		retryBtn.addEventListener("click", () => {
			retryBtn.remove();
			autoEnrollSaved().catch((err) => api?.logger.error("retry auto-enroll failed:", err));
		});
		document.body.appendChild(retryBtn);
		retryBtn.style.position = "fixed";
		retryBtn.style.bottom = "60px";
		retryBtn.style.right = "20px";
		retryBtn.style.zIndex = "99998";
	}
	async function waitForExamTable(timeoutMs) {
		const api = getApi();
		const start = Date.now();
		let pollCount = 0;
		let observer = null;
		let mutationCount = 0;
		function hasRows() {
			return getExamRows().length > 0;
		}
		api?.logger.info(`[exam-enroll-debug] waitForExamTable: starting poll, timeout=${timeoutMs}ms`);
		const observerTarget = document.querySelector("main") ?? document.body ?? document.documentElement;
		if (observerTarget) try {
			observer = new MutationObserver((mutations) => {
				mutationCount += mutations.length;
			});
			observer.observe(observerTarget, {
				childList: true,
				subtree: true
			});
		} catch (err) {
			api?.logger.warn("[exam-enroll-debug] waitForExamTable: failed to observe DOM changes", err);
		}
		while (Date.now() - start < timeoutMs) {
			if (hasRows()) {
				const rowCount = getExamRows().length;
				observer?.disconnect();
				api?.logger.info(`[exam-enroll-debug] waitForExamTable: found ${rowCount} rows after ${pollCount} polls (${Date.now() - start}ms, mutations=${mutationCount})`);
				return true;
			}
			pollCount++;
			await delay(EXAM_TABLE_WAIT_POLL_MS);
		}
		if (hasRows()) {
			const rowCount = getExamRows().length;
			observer?.disconnect();
			api?.logger.info(`[exam-enroll-debug] waitForExamTable: found ${rowCount} rows on final check (${Date.now() - start}ms, mutations=${mutationCount})`);
			return true;
		}
		observer?.disconnect();
		api?.logger.warn(`[exam-enroll-debug] waitForExamTable: timed out after ${pollCount} polls (${timeoutMs}ms, mutations=${mutationCount})`);
		return false;
	}
	var MONTH_LABELS = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	];
	var WEEKDAY_LABELS = [
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat",
		"Sun"
	];
	function todayKey(now) {
		const year = now.getFullYear();
		const month = now.getMonth() + 1;
		const day = now.getDate();
		return `${year}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`;
	}
	function compareEntries(a, b) {
		return a.parsed.day.localeCompare(b.parsed.day) || a.parsed.time.localeCompare(b.parsed.time) || a.subjectCode.localeCompare(b.subjectCode);
	}
	function getInitialMonth(entries, now) {
		const today = todayKey(now);
		const sorted = [...entries].sort(compareEntries);
		const upcoming = sorted.find((entry) => entry.parsed.day >= today) ?? sorted[sorted.length - 1];
		return {
			year: upcoming.parsed.year,
			month: upcoming.parsed.month
		};
	}
	function getDaysInMonth(year, month) {
		return new Date(year, month, 0).getDate();
	}
	function getMonthStartOffset(year, month) {
		return (new Date(year, month - 1, 1).getDay() + 6) % 7;
	}
	function groupByDay(entries) {
		const map = new Map();
		for (const entry of entries) {
			const dayEntries = map.get(entry.parsed.day) ?? [];
			dayEntries.push(entry);
			map.set(entry.parsed.day, dayEntries);
		}
		for (const dayEntries of map.values()) dayEntries.sort(compareEntries);
		return map;
	}
	function buildRegisteredExamCalendarEntries(rows) {
		const entries = [];
		for (const { info, subjectCode } of rows) {
			if (info.registrationState !== "registered") continue;
			const parsed = parseExamDateText(info.date);
			if (!parsed) continue;
			const resolvedSubjectCode = subjectCode ?? "Unknown subject";
			entries.push({
				id: `registered:${resolvedSubjectCode}:${parsed.day}:${parsed.time}`,
				subjectCode: resolvedSubjectCode,
				rawDate: info.date,
				parsed,
				type: info.type,
				courseCode: info.courseCode,
				source: "registered",
				registrationState: info.registrationState
			});
		}
		return entries.sort(compareEntries);
	}
	function renderExamCalendar(entries, now = new Date()) {
		if (entries.length === 0) return null;
		const today = todayKey(now);
		const entriesByDay = groupByDay(entries);
		let { year, month } = getInitialMonth(entries, now);
		let selectedDay = entries.find((entry) => entry.parsed.day >= today)?.parsed.day ?? entries[0]?.parsed.day;
		const root = document.createElement("div");
		root.style.cssText = "margin-top: 8px; padding: 7px; background: #0f2040; border-radius: 4px; color: #d9e7ff;";
		const label = document.createElement("div");
		label.style.cssText = "font-size: 10px; color: #8baae0; margin-bottom: 5px; display: flex; justify-content: space-between; gap: 6px;";
		label.textContent = "Registered exams";
		root.appendChild(label);
		const header = document.createElement("div");
		header.style.cssText = "display: flex; align-items: center; gap: 6px; margin-bottom: 6px;";
		const title = document.createElement("div");
		title.style.cssText = "font-weight: 700; color: #5c9eff; font-size: 11px; flex: 1;";
		const prevBtn = document.createElement("button");
		const nextBtn = document.createElement("button");
		for (const btn of [prevBtn, nextBtn]) {
			btn.type = "button";
			btn.style.cssText = "width: 24px; height: 22px; border: 1px solid #2c4875; background: #162d55; color: #d9e7ff; border-radius: 3px; cursor: pointer; font-size: 12px; line-height: 1;";
		}
		prevBtn.textContent = "<";
		prevBtn.title = "Previous month";
		nextBtn.textContent = ">";
		nextBtn.title = "Next month";
		header.appendChild(prevBtn);
		header.appendChild(title);
		header.appendChild(nextBtn);
		root.appendChild(header);
		const grid = document.createElement("div");
		grid.style.cssText = "display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px;";
		root.appendChild(grid);
		const details = document.createElement("div");
		details.style.cssText = "margin-top: 7px; border-top: 1px solid #1a3560; padding-top: 6px; max-height: 88px; overflow-y: auto;";
		root.appendChild(details);
		function renderDetails() {
			while (details.firstChild) details.removeChild(details.firstChild);
			const dayEntries = selectedDay ? entriesByDay.get(selectedDay) ?? [] : [];
			if (dayEntries.length === 0) {
				const empty = document.createElement("div");
				empty.style.cssText = "font-size: 10px; color: #8baae0;";
				empty.textContent = "No exam selected.";
				details.appendChild(empty);
				return;
			}
			for (const entry of dayEntries) {
				const row = document.createElement("div");
				row.style.cssText = "display: grid; grid-template-columns: auto 1fr auto; gap: 5px; align-items: baseline; padding: 2px 0; font-size: 10px;";
				const time = document.createElement("span");
				time.style.cssText = "color: #ffffff; font-weight: 700;";
				time.textContent = entry.parsed.time;
				row.appendChild(time);
				const label = document.createElement("span");
				label.style.cssText = "color: #b7cdf8; overflow-wrap: anywhere;";
				label.textContent = `${entry.subjectCode}${entry.courseCode ? ` (${entry.courseCode})` : ""}`;
				row.appendChild(label);
				const badge = document.createElement("span");
				badge.style.cssText = `color: ${entry.source === "registered" ? "#7de38b" : "#80b8ff"}; font-weight: 700;`;
				badge.textContent = entry.source === "registered" ? "Registered" : "Saved";
				row.appendChild(badge);
				details.appendChild(row);
			}
		}
		function renderMonth() {
			title.textContent = `${MONTH_LABELS[month - 1]} ${year}`;
			while (grid.firstChild) grid.removeChild(grid.firstChild);
			for (const label of WEEKDAY_LABELS) {
				const cell = document.createElement("div");
				cell.style.cssText = "font-size: 9px; color: #8baae0; text-align: center; font-weight: 700;";
				cell.textContent = label;
				grid.appendChild(cell);
			}
			for (let i = 0; i < getMonthStartOffset(year, month); i++) grid.appendChild(document.createElement("div"));
			for (let day = 1; day <= getDaysInMonth(year, month); day++) {
				const key = `${year}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`;
				const dayEntries = entriesByDay.get(key) ?? [];
				const hasRegistered = dayEntries.some((entry) => entry.source === "registered");
				const hasSaved = dayEntries.some((entry) => entry.source === "saved");
				const isSelected = selectedDay === key;
				const isToday = today === key;
				const btn = document.createElement("button");
				btn.type = "button";
				btn.style.cssText = [
					"height: 25px",
					"border-radius: 3px",
					"border: 1px solid transparent",
					"font-size: 10px",
					"font-weight: 700",
					"cursor: pointer",
					"letter-spacing: 0",
					dayEntries.length > 0 ? "color: #ffffff" : "color: #9db3d6",
					hasRegistered ? "background: #1f5f45" : hasSaved ? "background: #173f72" : "background: #172846",
					isSelected ? "border-color: #ffffff" : isToday ? "border-color: #ffcf66" : ""
				].filter(Boolean).join(";");
				btn.textContent = `${day}`;
				btn.title = dayEntries.map((entry) => `${entry.parsed.time} ${entry.subjectCode} (${entry.source})`).join("\n");
				btn.addEventListener("click", () => {
					selectedDay = key;
					renderMonth();
					renderDetails();
				});
				grid.appendChild(btn);
			}
		}
		prevBtn.addEventListener("click", () => {
			month--;
			if (month < 1) {
				month = 12;
				year--;
			}
			renderMonth();
		});
		nextBtn.addEventListener("click", () => {
			month++;
			if (month > 12) {
				month = 1;
				year++;
			}
			renderMonth();
		});
		renderMonth();
		renderDetails();
		return root;
	}
	var PREVIEW_STYLE_ID = "npu-exam-preview-style";
	var PREVIEW_ATTRIBUTE = "data-npu-exam-preview";
	var previewInFlight = null;
	function ensurePreviewStyle() {
		if (document.getElementById(PREVIEW_STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = PREVIEW_STYLE_ID;
		style.textContent = `
    [${PREVIEW_ATTRIBUTE}="row"] {
      box-shadow: inset 4px 0 0 #4f8cff !important;
      background: rgba(79, 140, 255, 0.12) !important;
    }
    [${PREVIEW_ATTRIBUTE}="enrollment-button"] {
      outline: 3px solid #ffb020 !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE}="unavailable-row"] {
      box-shadow: inset 4px 0 0 #d64545 !important;
      background: rgba(214, 69, 69, 0.12) !important;
    }
    [${PREVIEW_ATTRIBUTE}="unavailable-enrollment-button"] {
      outline: 3px solid #d64545 !important;
      outline-offset: 2px !important;
    }
  `;
		document.head.appendChild(style);
	}
	function clearExamPreview() {
		document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`).forEach((element) => {
			element.removeAttribute(PREVIEW_ATTRIBUTE);
		});
	}
	async function runExamPreview() {
		const api = getApi();
		const preferences = await loadPreferences();
		const entries = Object.entries(preferences);
		clearExamPreview();
		ensurePreviewStyle();
		const result = {
			savedExams: entries.length,
			matchedExams: 0,
			availableExams: 0,
			matchedRows: 0,
			enrollmentButtons: 0,
			availableEnrollmentButtons: 0,
			missing: []
		};
		if (entries.length === 0) {
			api?.statusPanel.addMessage("info", "No saved exams to preview. No clicks were made.");
			return result;
		}
		const tableSubjectCodes = buildTableSubjectCodeMap();
		const pageSubjectCode = getSubjectCode();
		const matchedSubjects = new Set();
		const availableSubjects = new Set();
		for (const row of getExamRows()) {
			const subjectCode = getRowSubjectCode(row, tableSubjectCodes) ?? pageSubjectCode;
			if (!subjectCode) continue;
			const preference = preferences[subjectCode];
			if (!preference) continue;
			const info = parseExamRow(row);
			if (info.date !== preference.date) continue;
			matchedSubjects.add(subjectCode);
			result.matchedRows++;
			if (info.felvetelBtn) result.enrollmentButtons++;
			if (info.felvetelBtn && isElementAvailable(info.felvetelBtn)) {
				result.availableEnrollmentButtons++;
				availableSubjects.add(subjectCode);
				row.setAttribute(PREVIEW_ATTRIBUTE, "row");
				info.felvetelBtn.setAttribute(PREVIEW_ATTRIBUTE, "enrollment-button");
			} else {
				row.setAttribute(PREVIEW_ATTRIBUTE, "unavailable-row");
				info.felvetelBtn?.setAttribute(PREVIEW_ATTRIBUTE, "unavailable-enrollment-button");
			}
		}
		for (const [subjectCode, preference] of entries) if (!matchedSubjects.has(subjectCode)) result.missing.push(`${subjectCode}: ${preference.date} not visible`);
		else if (!availableSubjects.has(subjectCode)) result.missing.push(`${subjectCode}: ${preference.date} has no available enrollment button`);
		result.matchedExams = matchedSubjects.size;
		result.availableExams = availableSubjects.size;
		api?.logger.info("exam preview result", result);
		api?.statusPanel.addMessage(result.missing.length === 0 ? "info" : "warn", `Preview: ${result.matchedExams}/${result.savedExams} saved exams matched; ${result.availableEnrollmentButtons}/${result.enrollmentButtons} enrollment buttons available. No clicks were made.`);
		return result;
	}
	function previewSavedExams() {
		if (previewInFlight) return previewInFlight;
		const run = runExamPreview();
		previewInFlight = run;
		const clearInFlight = () => {
			if (previewInFlight === run) previewInFlight = null;
		};
		run.then(clearInFlight, clearInFlight);
		return run;
	}
	var EXAM_UI_BUILD = "3.3.0 safe-preview";
	async function savePreferredExam(subjectCode, date, type, courseCode) {
		const api = getApi();
		const prefs = await loadPreferences();
		prefs[subjectCode] = {
			date,
			type,
			courseCode
		};
		await savePreferences(prefs);
		api?.logger.info(`saved exam preference for ${subjectCode}: ${date}`);
		api?.statusPanel.addMessage("info", `Saved exam date: ${date}`);
		await renderModuleUI();
	}
	async function clearPreference(subjectCode) {
		const api = getApi();
		const prefs = await loadPreferences();
		delete prefs[subjectCode];
		await savePreferences(prefs);
		api?.logger.info(`cleared exam preference for ${subjectCode}`);
		api?.statusPanel.addMessage("info", "Saved exam date cleared.");
		clearHighlights();
		clearExamPreview();
		await renderModuleUI();
	}
	async function renderModuleUI() {
		const api = getApi();
		if (!api) return;
		clearExamPreview();
		const container = document.createElement("div");
		container.style.cssText = "font-size: 12px;";
		const debugEnabled = isDebugEnabled();
		const heading = document.createElement("div");
		heading.style.cssText = "font-weight: bold; color: #5c9eff; margin-bottom: 6px;";
		heading.textContent = "Exam Planner";
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
				autoEnrollSaved().catch((err) => api?.logger.error("auto-enroll failed:", err));
			});
			container.appendChild(autoBtn);
			const clearBtn = document.createElement("button");
			clearBtn.style.cssText = `${btnStyle} background: #c62828; color: white;`;
			clearBtn.textContent = "Clear";
			clearBtn.addEventListener("click", () => {
				if (subjectCode) clearPreference(subjectCode).catch((err) => api?.logger.error("clear failed:", err));
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
			const previewBtn = document.createElement("button");
			previewBtn.style.cssText = `${btnStyle} background: #37474f; color: white;`;
			previewBtn.textContent = "Preview Saved";
			previewBtn.title = "Highlight saved exam matches and enrollment buttons without clicking";
			previewBtn.addEventListener("click", () => {
				previewSavedExams().catch((err) => api?.logger.error("exam preview failed:", err));
			});
			container.appendChild(previewBtn);
			const clearPreviewBtn = document.createElement("button");
			clearPreviewBtn.style.cssText = `${btnStyle} background: #455a64; color: white;`;
			clearPreviewBtn.textContent = "Clear Preview";
			clearPreviewBtn.addEventListener("click", () => {
				clearExamPreview();
				api.statusPanel.addMessage("info", "Exam preview cleared.");
			});
			container.appendChild(clearPreviewBtn);
			const previewHint = document.createElement("div");
			previewHint.style.cssText = "margin-top: 4px; font-size: 10px; color: #6a7a8a;";
			previewHint.textContent = "Preview only highlights matches; it never clicks enrollment buttons.";
			container.appendChild(previewHint);
		}
		const calendar = renderExamCalendar(buildRegisteredExamCalendarEntries(getExamRows().map((row) => ({
			info: parseExamRow(row),
			subjectCode: getRowSubjectCode(row) ?? subjectCode
		}))));
		if (calendar) container.appendChild(calendar);
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
					clearPreference(code).catch((err) => api?.logger.error("clear failed:", err));
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
			savePreferredExam(sc, date, type, courseCode).catch((err) => api?.logger.error("save exam pref failed:", err));
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
		api.statusPanel.setModuleContentElement(container);
	}
	var EXAM_TABLE_WAIT_MS = 3e4;
	var EXAM_RUSH_SETTLE_MS = 2e3;
	var savedChoicesUnsub = null;
	var examSignupModule = {
		id: "exam-signup",
		name: "Exam Planner",
		description: "Visualize registered exams, save preferred dates, and enroll them from the page",
		shouldActivate(context) {
			return /\/exams\/overview\/registration\/?$/.test(context.path);
		},
		async initialize(moduleApi) {
			setApi(moduleApi);
			setIsDisposed(false);
			setIsEnrollmentInProgress(false);
			const api = moduleApi;
			if (!await waitForExamTable(EXAM_TABLE_WAIT_MS)) {
				api.logger.warn(`exam table not found after ${EXAM_TABLE_WAIT_MS / 1e3}s`);
				api.statusPanel.addMessage("warn", "Exam table did not load yet. Refresh after Neptun finishes loading.");
				return;
			}
			await renderModuleUI();
			savedChoicesUnsub?.();
			savedChoicesUnsub = api.bus.on("saved-choices:restored", () => {
				renderModuleUI().catch((err) => api.logger.error("failed to refresh restored choices:", err));
			});
			const subjectCode = getSubjectCode();
			if (subjectCode) {
				if ((await loadPreferences())[subjectCode]) api.logger.info(`found saved exam preference for ${subjectCode}, ready to auto-enroll`);
			}
			if (api.statusPanel.getExamRushMode()) {
				api.logger.info("Exam Rush Mode active - scanning visible exam tables for saved targets");
				api.statusPanel.addMessage("info", "Scanning visible exam tables...");
				await delay(EXAM_RUSH_SETTLE_MS);
				autoEnrollSaved().catch((err) => api.logger.error("rush exam auto-enroll failed:", err));
			}
			api.logger.info("initialized on exam page");
		},
		dispose() {
			setIsDisposed(true);
			setIsEnrollmentInProgress(false);
			savedChoicesUnsub?.();
			savedChoicesUnsub = null;
			const timer = getDebounceTimer();
			if (timer) {
				clearTimeout(timer);
				setDebounceTimer(null);
			}
			getTableObserver()?.disconnect();
			setTableObserver(null);
			clearExamPreview();
			clearHighlights();
			document.querySelectorAll(".npu-exam-save-btn").forEach((b) => b.remove());
			document.querySelectorAll(".npu-exam-save-slot").forEach((slot) => slot.remove());
			document.querySelectorAll(".npu-exam-retry-btn").forEach((b) => b.remove());
			setCachedSubjectCode(void 0);
			setApi(null);
		}
	};
	var STORAGE_KEY = "versionWatch";
	var RETEST_DETAIL = "Retest Course Store, Course Rush, Exam Signup, Exam Rush, and Infinite Session.";
	var api = null;
	var observer = null;
	var checkInFlight = false;
	function normalizeText(text) {
		return text.replace(/\s+/g, " ").trim();
	}
	function parseNeptunVersionText(text) {
		const raw = normalizeText(text);
		const match = raw.match(/(?:verzió|verzio|version)\s*:\s*([^\s(]+)(?:\s*\(([^)]+)\))?/i);
		if (!match) return null;
		return {
			raw,
			version: match[1],
			buildTime: match[2]
		};
	}
	function findNeptunVersion(doc = document) {
		const direct = doc.querySelector(".footer__version");
		const directVersion = direct ? parseNeptunVersionText(direct.textContent ?? "") : null;
		if (directVersion) return directVersion;
		const candidates = doc.querySelectorAll("[class*=\"version\"], footer");
		for (const candidate of Array.from(candidates)) {
			const version = parseNeptunVersionText(candidate.textContent ?? "");
			if (version) return version;
		}
		return null;
	}
	async function acknowledgeVersion(current) {
		if (!api) return;
		const state = await api.storage.getForDomain(STORAGE_KEY);
		await api.storage.setForDomain(STORAGE_KEY, {
			lastSeenRaw: current.raw,
			lastSeenVersion: current.version,
			acknowledgedRaw: current.raw,
			previousRaw: state?.previousRaw
		});
		api.statusPanel.setVersionWarning(null);
		api.statusPanel.addMessage("info", "Neptun version marked as retested.");
	}
	function showWarning(current, state, semanticChanged = state.lastSeenVersion !== current.version) {
		if (!api) return;
		api.statusPanel.setVersionWarning({
			title: semanticChanged ? "Neptun version changed" : "Neptun build changed",
			detail: semanticChanged ? RETEST_DETAIL : "Quick smoke test recommended.",
			previous: state.previousRaw,
			current: current.raw,
			actionLabel: "Mark Retested",
			onAction: () => acknowledgeVersion(current)
		});
		api.statusPanel.addMessage("warn", semanticChanged ? "Neptun version changed. Retest NPU features." : "Neptun build changed.");
		api.statusPanel.expand();
	}
	async function checkCurrentVersion() {
		if (!api || checkInFlight) return false;
		const current = findNeptunVersion();
		if (!current) return false;
		checkInFlight = true;
		try {
			const state = await api.storage.getForDomain(STORAGE_KEY);
			if (!state) {
				await api.storage.setForDomain(STORAGE_KEY, {
					lastSeenRaw: current.raw,
					lastSeenVersion: current.version,
					acknowledgedRaw: current.raw
				});
				api.logger.info(`stored initial Neptun version: ${current.raw}`);
				return true;
			}
			if (state.lastSeenRaw !== current.raw) {
				const semanticChanged = state.lastSeenVersion !== current.version;
				const nextState = {
					lastSeenRaw: current.raw,
					lastSeenVersion: current.version,
					acknowledgedRaw: state.acknowledgedRaw,
					previousRaw: state.lastSeenRaw
				};
				await api.storage.setForDomain(STORAGE_KEY, nextState);
				showWarning(current, nextState, semanticChanged);
				return true;
			}
			if (state.acknowledgedRaw !== current.raw) {
				showWarning(current, state);
				return true;
			}
			api.statusPanel.setVersionWarning(null);
			return true;
		} finally {
			checkInFlight = false;
		}
	}
	function startObserver() {
		if (observer || !document.body) return;
		observer = new MutationObserver(() => {
			checkCurrentVersion().then((found) => {
				if (found) {
					observer?.disconnect();
					observer = null;
				}
			});
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
	}
	var versionWatchModule = {
		id: "version-watch",
		name: "Version Watch",
		description: "Warns when the Neptun footer version changes so NPU can be retested",
		shouldActivate(_context) {
			return true;
		},
		async initialize(moduleApi) {
			api = moduleApi;
			if (!await checkCurrentVersion()) startObserver();
		},
		dispose() {
			observer?.disconnect();
			observer = null;
			checkInFlight = false;
			api?.statusPanel.setVersionWarning(null);
			api = null;
		}
	};
	var CONSENT_KEY = "consentAccepted";
	async function hasConsent(storage) {
		return await storage.getForDomain(CONSENT_KEY) === true;
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
			for (const bullet of [
				{
					bold: "Session keep-alive is best-effort",
					rest: "; Neptun may still force logout during course or exam rushes"
				},
				{
					bold: "Clicks course controls",
					rest: " when you ask it to enroll saved selections"
				},
				{
					bold: "Clicks exam controls",
					rest: " when you ask it to enroll saved exam dates"
				},
				{
					bold: "May conflict with rules",
					rest: " at your university or faculty"
				}
			]) {
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
	var RUSH_PATHS = {
		course: "subjects/registration",
		exam: "exams/overview/registration"
	};
	var REDIRECT_COUNT_KEY = "npu:rushRedirectCount";
	var MAX_REDIRECTS = 2;
	function hasAccessToken() {
		try {
			return Boolean(sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken));
		} catch {
			return false;
		}
	}
	function getPortalPrefix(pathname = window.location.pathname) {
		return pathname.split("/")[1] || "hallgatoi";
	}
	function buildRushUrl(kind, pathname, origin) {
		return `${origin}/${getPortalPrefix(pathname)}/${RUSH_PATHS[kind]}`;
	}
	function isOnRushPage(kind, path) {
		return path.includes(`/${RUSH_PATHS[kind]}`);
	}
	function isOnLoginPage(path) {
		return path.endsWith("/login") || path === "/login";
	}
	function readRedirectCount() {
		try {
			const raw = sessionStorage.getItem(REDIRECT_COUNT_KEY);
			const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
			return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
		} catch {
			return 0;
		}
	}
	function noteRedirect() {
		try {
			sessionStorage.setItem(REDIRECT_COUNT_KEY, String(readRedirectCount() + 1));
		} catch {}
	}
	function clearRedirectBudget() {
		try {
			sessionStorage.removeItem(REDIRECT_COUNT_KEY);
		} catch {}
	}
	function decideRushRedirect(kind, path, authenticated, redirectCount = readRedirectCount(), origin = window.location.origin) {
		if (isOnRushPage(kind, path)) return { action: "already-there" };
		if (!authenticated || isOnLoginPage(path)) return { action: "wait-for-login" };
		if (redirectCount >= MAX_REDIRECTS) return { action: "budget-exhausted" };
		return {
			action: "navigate",
			url: buildRushUrl(kind, path, origin)
		};
	}
	function performRushRedirect(url) {
		noteRedirect();
		window.location.href = url;
	}
	var SAVED_CHOICES_SCHEMA = "npu.saved-choices.v1";
	var COURSE_SELECTIONS_KEY = "courseSelections";
	var EXAM_PREFERENCES_KEY = "examPreferences";
	var MAX_CODE_LENGTH = 200;
	var MAX_EXAM_FIELD_LENGTH = 500;
	var MAX_SUBJECTS = 2e3;
	var MAX_COURSES_PER_SUBJECT = 2e3;
	var UNSAFE_RECORD_KEYS = new Set([
		"__proto__",
		"constructor",
		"prototype"
	]);
	function isRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	function isValidRecordKey(value) {
		return value.length > 0 && value.length <= MAX_CODE_LENGTH && value.trim() === value && !UNSAFE_RECORD_KEYS.has(value);
	}
	function setOwn(target, key, value) {
		Object.defineProperty(target, key, {
			value,
			enumerable: true,
			configurable: true,
			writable: true
		});
	}
	function sanitizeCourseSelections(value) {
		if (!isRecord(value)) return {};
		const selections = {};
		for (const [rawSubjectCode, rawCourseCodes] of Object.entries(value)) {
			const subjectCode = rawSubjectCode.trim();
			if (!isValidRecordKey(subjectCode) || !Array.isArray(rawCourseCodes)) continue;
			const courseCodes = Array.from(new Set(rawCourseCodes.filter((courseCode) => typeof courseCode === "string").map((courseCode) => courseCode.trim()).filter((courseCode) => isValidRecordKey(courseCode)))).slice(0, MAX_COURSES_PER_SUBJECT);
			if (courseCodes.length > 0) setOwn(selections, subjectCode, courseCodes);
			if (Object.keys(selections).length >= MAX_SUBJECTS) break;
		}
		return selections;
	}
	function sanitizeExamPreferences(value) {
		if (!isRecord(value)) return {};
		const preferences = {};
		for (const [rawSubjectCode, rawPreference] of Object.entries(value)) {
			const subjectCode = rawSubjectCode.trim();
			if (!isValidRecordKey(subjectCode) || !isRecord(rawPreference)) continue;
			const date = typeof rawPreference.date === "string" ? rawPreference.date.trim() : "";
			if (date.length === 0 || date.length > MAX_EXAM_FIELD_LENGTH) continue;
			setOwn(preferences, subjectCode, {
				date,
				type: typeof rawPreference.type === "string" ? rawPreference.type.trim().slice(0, MAX_EXAM_FIELD_LENGTH) : "",
				courseCode: typeof rawPreference.courseCode === "string" ? rawPreference.courseCode.trim().slice(0, MAX_CODE_LENGTH) : ""
			});
			if (Object.keys(preferences).length >= MAX_SUBJECTS) break;
		}
		return preferences;
	}
	function parseCourseSelections(value) {
		if (!isRecord(value)) throw new Error("The backup has an invalid courseSelections section.");
		const entries = Object.entries(value);
		if (entries.length > MAX_SUBJECTS) throw new Error("The backup contains too many saved subjects.");
		const selections = {};
		for (const [subjectCode, courseCodes] of entries) {
			if (!isValidRecordKey(subjectCode) || !Array.isArray(courseCodes)) throw new Error(`The backup has an invalid course selection for "${subjectCode}".`);
			if (courseCodes.length === 0 || courseCodes.length > MAX_COURSES_PER_SUBJECT) throw new Error(`The backup has an invalid course list for "${subjectCode}".`);
			const cleanCodes = [];
			const seen = new Set();
			for (const courseCode of courseCodes) {
				if (typeof courseCode !== "string" || !isValidRecordKey(courseCode) || seen.has(courseCode)) throw new Error(`The backup has an invalid course code for "${subjectCode}".`);
				seen.add(courseCode);
				cleanCodes.push(courseCode);
			}
			setOwn(selections, subjectCode, cleanCodes);
		}
		return selections;
	}
	function parseExamPreferences(value) {
		if (!isRecord(value)) throw new Error("The backup has an invalid examPreferences section.");
		const entries = Object.entries(value);
		if (entries.length > MAX_SUBJECTS) throw new Error("The backup contains too many saved exams.");
		const preferences = {};
		for (const [subjectCode, preference] of entries) {
			if (!isValidRecordKey(subjectCode) || !isRecord(preference)) throw new Error(`The backup has an invalid exam preference for "${subjectCode}".`);
			const { date, type, courseCode } = preference;
			if (typeof date !== "string" || date.length === 0 || date.trim() !== date || date.length > MAX_EXAM_FIELD_LENGTH || typeof type !== "string" || type.trim() !== type || type.length > MAX_EXAM_FIELD_LENGTH || typeof courseCode !== "string" || courseCode.trim() !== courseCode || courseCode.length > MAX_CODE_LENGTH) throw new Error(`The backup has an invalid exam preference for "${subjectCode}".`);
			setOwn(preferences, subjectCode, {
				date,
				type,
				courseCode
			});
		}
		return preferences;
	}
	async function createSavedChoicesBackup(storage, exportedAt = new Date()) {
		const [courseSelections, examPreferences] = await Promise.all([storage.getForDomain(COURSE_SELECTIONS_KEY), storage.getForDomain(EXAM_PREFERENCES_KEY)]);
		return {
			schema: SAVED_CHOICES_SCHEMA,
			exportedAt: exportedAt.toISOString(),
			courseSelections: sanitizeCourseSelections(courseSelections),
			examPreferences: sanitizeExamPreferences(examPreferences)
		};
	}
	function serializeSavedChoicesBackup(backup) {
		return `${JSON.stringify(backup, null, 2)}\n`;
	}
	function parseSavedChoicesBackup(text) {
		if (text.length > 1e6) throw new Error("The selected backup is too large.");
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error("The selected file is not valid JSON.");
		}
		if (!isRecord(parsed) || parsed.schema !== "npu.saved-choices.v1") throw new Error("The selected file is not a supported NPU saved choices backup.");
		if (typeof parsed.exportedAt !== "string" || parsed.exportedAt.length === 0 || !Number.isFinite(Date.parse(parsed.exportedAt))) throw new Error("The backup has an invalid export date.");
		return {
			schema: SAVED_CHOICES_SCHEMA,
			exportedAt: parsed.exportedAt,
			courseSelections: parseCourseSelections(parsed.courseSelections),
			examPreferences: parseExamPreferences(parsed.examPreferences)
		};
	}
	async function restoreSavedChoicesBackup(storage, backup) {
		const values = {
			[COURSE_SELECTIONS_KEY]: backup.courseSelections,
			[EXAM_PREFERENCES_KEY]: backup.examPreferences
		};
		if (storage.setForDomainValues) {
			await storage.setForDomainValues(values);
			return;
		}
		await storage.setForDomain(COURSE_SELECTIONS_KEY, backup.courseSelections);
		await storage.setForDomain(EXAM_PREFERENCES_KEY, backup.examPreferences);
	}
	function countSavedChoices(backup) {
		return {
			subjects: Object.keys(backup.courseSelections).length,
			courses: Object.values(backup.courseSelections).reduce((sum, codes) => sum + codes.length, 0),
			exams: Object.keys(backup.examPreferences).length
		};
	}
	function savedChoicesBackupFilename(exportedAt) {
		return `npu-saved-choices-${exportedAt.slice(0, 10)}.json`;
	}
	function downloadSavedChoicesBackup(backup, documentRef = document, objectUrlApi = URL) {
		const filename = savedChoicesBackupFilename(backup.exportedAt);
		const blob = new Blob([serializeSavedChoicesBackup(backup)], { type: "application/json;charset=utf-8" });
		const url = objectUrlApi.createObjectURL(blob);
		const link = documentRef.createElement("a");
		link.href = url;
		link.download = filename;
		link.style.display = "none";
		documentRef.body.appendChild(link);
		try {
			link.click();
		} finally {
			link.remove();
			window.setTimeout(() => objectUrlApi.revokeObjectURL(url), 0);
		}
		return filename;
	}
	function chooseSavedChoicesBackupFile(documentRef = document) {
		return new Promise((resolve) => {
			const input = documentRef.createElement("input");
			input.type = "file";
			input.accept = "application/json,.json";
			input.style.display = "none";
			let settled = false;
			const finish = (file) => {
				if (settled) return;
				settled = true;
				input.remove();
				resolve(file);
			};
			input.addEventListener("change", () => finish(input.files?.[0] ?? null));
			input.addEventListener("cancel", () => finish(null));
			documentRef.body.appendChild(input);
			input.click();
		});
	}
	async function readSavedChoicesBackupFile(file) {
		if (file.size > 1e6) throw new Error("The selected backup is too large.");
		return file.text();
	}
	function describeSavedChoices(verb, counts) {
		return `${verb} ${counts.subjects} saved subject${counts.subjects === 1 ? "" : "s"}, ${counts.courses} course${counts.courses === 1 ? "" : "s"}, and ${counts.exams} exam${counts.exams === 1 ? "" : "s"}.`;
	}
	async function main() {
		const logger = createLogger("core");
		if (!isLikelyNeptunPortal()) return;
		logger.info("Neptun PowerUp! v3 starting...");
		if (typeof GM === "undefined" || typeof GM.getValue !== "function" || typeof GM.setValue !== "function") {
			logger.error("Tampermonkey GM storage API is unavailable; NPU will not activate.");
			return;
		}
		const gmStorage = {
			getValue: (key, defaultVal) => GM.getValue(key, defaultVal),
			setValue: (key, value) => GM.setValue(key, value)
		};
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
		if (!await hasConsent(rushStorage)) {
			if (await showConsentDialog(typeof GM !== "undefined" && GM.info?.script?.version ? GM.info.script.version : "dev")) {
				await storeConsent(rushStorage);
				logger.info("consent accepted");
			} else {
				logger.info("consent declined — NPU will not activate");
				return;
			}
		}
		const courseRushInitial = await rushStorage.get("courseRushMode") ?? false;
		const examRushInitial = await rushStorage.get("examRushMode") ?? false;
		if (await rushStorage.get("pinkMode") === true) {
			await rushStorage.setForDomain("themeSettings", {
				enabled: true,
				color: "pink"
			});
			await rushStorage.remove("pinkMode");
			logger.info("migrated pinkMode=true to themeSettings");
		}
		const themeInitial = await rushStorage.getForDomain("themeSettings") ?? { ...DEFAULT_THEME };
		logger.info(`rush mode initial state — course: ${courseRushInitial}, exam: ${examRushInitial}`);
		const statusPanel = createStatusPanel(bus, {
			onCourseRushChange: async (on) => {
				try {
					await rushStorage.set("courseRushMode", on);
				} catch (err) {
					logger.error("failed to persist courseRushMode:", err);
				}
				logger.info(`Course Rush Mode ${on ? "ON" : "OFF"}`);
				statusPanel.addMessage("info", `Course Rush ${on ? "on" : "off"}`);
			},
			onExamRushChange: async (on) => {
				try {
					await rushStorage.set("examRushMode", on);
				} catch (err) {
					logger.error("failed to persist examRushMode:", err);
				}
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
			},
			onExportSavedChoices: async () => {
				try {
					const backup = await createSavedChoicesBackup(rushStorage);
					downloadSavedChoicesBackup(backup);
					const message = describeSavedChoices("Exported", countSavedChoices(backup));
					logger.info(message);
					return message;
				} catch (err) {
					logger.error("failed to export saved choices:", err);
					throw err;
				}
			},
			onImportSavedChoices: async () => {
				try {
					const file = await chooseSavedChoicesBackupFile();
					if (!file) return null;
					const backup = parseSavedChoicesBackup(await readSavedChoicesBackupFile(file));
					const counts = countSavedChoices(backup);
					if (!window.confirm(`Import ${counts.subjects} saved subject${counts.subjects === 1 ? "" : "s"}, ${counts.courses} course${counts.courses === 1 ? "" : "s"}, and ${counts.exams} exam${counts.exams === 1 ? "" : "s"}? This replaces the current saved course and exam choices for this Neptun domain.`)) return null;
					await restoreSavedChoicesBackup(rushStorage, backup);
					const message = describeSavedChoices("Imported", counts);
					logger.info(message);
					statusPanel.addMessage("info", message);
					bus.emit("saved-choices:restored", {});
					return message;
				} catch (err) {
					logger.error("failed to import saved choices:", err);
					throw err;
				}
			}
		}, {
			courseRush: courseRushInitial,
			examRush: examRushInitial
		}, themeInitial);
		const stopInterceptor = setupInterceptor(bus, createLogger("interceptor"));
		const registry = createModuleRegistry(bus, gmStorage, statusPanel);
		registry.register(versionWatchModule);
		registry.register(infiniteSessionModule);
		registry.register(courseStoreModule);
		registry.register(examSignupModule);
		registry.register(pinkModeModule);
		await registry.activateAll(buildContext());
		function tryRushRedirect(kind, reason) {
			const path = extractPath(window.location.href);
			const decision = decideRushRedirect(kind, path, hasAccessToken());
			if (decision.action === "already-there") {
				clearRedirectBudget();
				return false;
			}
			if (decision.action === "budget-exhausted") {
				logger.warn(`${kind} rush: redirect budget exhausted, staying on ${path}`);
				statusPanel.addMessage("warn", `Could not reach the ${kind === "course" ? "course registration" : "exam"} page automatically. Open it manually and re-enable the rush.`);
				return false;
			}
			if (decision.action === "wait-for-login") return false;
			logger.info(`${kind} rush: navigating to rush page (${reason})`);
			statusPanel.addMessage("info", `Opening ${kind === "course" ? "course registration" : "exam overview"} for ${kind === "course" ? "Course" : "Exam"} Rush...`);
			registry.disposeAll();
			performRushRedirect(decision.url);
			return true;
		}
		function armedRushKind() {
			if (statusPanel.getCourseRushMode()) return "course";
			if (statusPanel.getExamRushMode()) return "exam";
			return null;
		}
		const initialRush = armedRushKind();
		if (initialRush) {
			if (isOnRushPage(initialRush, extractPath(window.location.href))) clearRedirectBudget();
			else if (!tryRushRedirect(initialRush, "page load")) {
				const stopWaiting = bus.on("token:acquired", () => {
					const kind = armedRushKind();
					if (!kind) {
						stopWaiting();
						return;
					}
					if (tryRushRedirect(kind, "token acquired")) stopWaiting();
				});
			}
		} else clearRedirectBudget();
		observeRouteChanges(bus);
		bus.on("page:changed", async () => {
			logger.info(`route changed: ${window.location.pathname}`);
			const rushKind = armedRushKind();
			if (rushKind && tryRushRedirect(rushKind, "route change")) return;
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
