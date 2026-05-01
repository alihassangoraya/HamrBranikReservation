const DEFAULT_SETTINGS = {
  username: "isafder",
  password: "YLpHiR",
  numberOfCourts: 2,
  timeLimit: 27,
  maxEndTime: "738000000000"
};

const extApi = typeof browser !== "undefined" ? browser : chrome;

const usernameEl = document.getElementById("username");
const passwordEl = document.getElementById("password");
const numberOfCourtsEl = document.getElementById("numberOfCourts");
const allowedDaysEl = document.getElementById("allowedDays");
const fromTimeIndexEl = document.getElementById("fromTimeIndex");
const durationSlotsEl = document.getElementById("durationSlots");
const enableLastMinuteWatchEl = document.getElementById("enableLastMinuteWatch");
const watchFieldsEl = document.getElementById("watchFields");
const watchDayEl = document.getElementById("watchDay");
const watchStartIndexEl = document.getElementById("watchStartIndex");
const watchDurationSlotsEl = document.getElementById("watchDurationSlots");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b00020" : "#0a7b2d";
}

function syncWatchFieldsVisibility() {
  watchFieldsEl.classList.toggle("hidden", !enableLastMinuteWatchEl.checked);
}

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      const result = extApi.storage.local.get(keys, (items) => resolve(items || {}));
      if (result && typeof result.then === "function") {
        result.then((items) => resolve(items || {})).catch(() => resolve({}));
      }
    } catch {
      resolve({});
    }
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    try {
      const result = extApi.storage.local.set(values, () => {
        const err = extApi.runtime?.lastError;
        if (err) reject(err);
        else resolve();
      });
      if (result && typeof result.then === "function") {
        result.then(() => resolve()).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function fillForm(settings) {
  usernameEl.value = settings.username ?? DEFAULT_SETTINGS.username;
  passwordEl.value = settings.password ?? DEFAULT_SETTINGS.password;
  numberOfCourtsEl.value = settings.numberOfCourts ?? DEFAULT_SETTINGS.numberOfCourts;
  const allowedDays = Array.isArray(settings.allowedDays) && settings.allowedDays.length
    ? settings.allowedDays
    : ["Út", "St", "Čt", "Pá"];
  Array.from(allowedDaysEl.options).forEach((opt) => {
    opt.selected = allowedDays.includes(opt.value);
  });
  fromTimeIndexEl.value = String(settings.fromTimeIndex ?? 23);
  const durationSlots = Number(settings.durationSlots ?? Math.min(4, Math.max(2, (Number(settings.timeLimit ?? DEFAULT_SETTINGS.timeLimit) - Number(settings.fromTimeIndex ?? 23) + 1))));
  durationSlotsEl.value = String(durationSlots);
  enableLastMinuteWatchEl.checked = Boolean(settings.enableLastMinuteWatch);
  watchDayEl.value = settings.watchDay ?? "Pá";
  watchStartIndexEl.value = String(settings.watchStartIndex ?? 23);
  watchDurationSlotsEl.value = String(settings.watchDurationSlots ?? 1);
  syncWatchFieldsVisibility();

}

async function loadSettings() {
  const settings = await storageGet(["username", "password", "numberOfCourts", "allowedDays", "fromTimeIndex", "durationSlots", "timeLimit", "toTime", "enableLastMinuteWatch", "watchDay", "watchStartIndex", "watchDurationSlots"]);
  fillForm(settings);
}

async function saveSettings() {
  const fromTimeIndex = Math.max(0, Number(fromTimeIndexEl.value) || 23);
  const durationSlots = Math.min(4, Math.max(2, Number(durationSlotsEl.value) || 4));
  const computedTimeLimit = Math.min(31, fromTimeIndex + durationSlots - 1);

  const payload = {
    username: usernameEl.value.trim(),
    password: passwordEl.value,
    numberOfCourts: Math.min(2, Math.max(1, Number(numberOfCourtsEl.value) || DEFAULT_SETTINGS.numberOfCourts)),
    allowedDays: Array.from(allowedDaysEl.selectedOptions).map((opt) => opt.value),
    fromTimeIndex,
    durationSlots,
    timeLimit: computedTimeLimit,
    toTime: ["702000000000", "720000000000", "738000000000"],
    enableLastMinuteWatch: enableLastMinuteWatchEl.checked,
    watchDay: watchDayEl.value,
    watchStartIndex: Math.max(0, Number(watchStartIndexEl.value) || 23),
    watchDurationSlots: Math.min(4, Math.max(1, Number(watchDurationSlotsEl.value) || 1))
  };

  if (!payload.username || !payload.password) {
    setStatus("Username and password are required.", true);
    return;
  }
  if (!payload.allowedDays.length) {
    setStatus("Please select at least one day.", true);
    return;
  }
  const slotCount = payload.durationSlots; // 30-min blocks
  const maxSlotsForCourts = Math.floor(8 / payload.numberOfCourts); // 4 court-hours/day
  if (slotCount > maxSlotsForCourts) {
    setStatus(`Too long for ${payload.numberOfCourts} court(s). Max is ${maxSlotsForCourts * 30} minutes.`, true);
    return;
  }
  if (payload.enableLastMinuteWatch && (payload.watchStartIndex + payload.watchDurationSlots - 1) > 31) {
    setStatus("Watch slot range exceeds the schedule.", true);
    return;
  }
  await storageSet(payload);
  setStatus("Settings saved.");
}

async function resetSettings() {
  fillForm(DEFAULT_SETTINGS);
  await saveSettings();
}

saveBtn.addEventListener("click", () => {
  saveSettings().catch(() => setStatus("Failed to save settings.", true));
});

resetBtn.addEventListener("click", () => {
  resetSettings().catch(() => setStatus("Failed to reset settings.", true));
});

enableLastMinuteWatchEl.addEventListener("change", syncWatchFieldsVisibility);

(function populateTimeDropdowns() {
  for (let i = 0; i <= 31; i++) {
    const totalMinutes = 7 * 60 + i * 30;
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    const text = `${hh}:${mm}`;

    const fromOption = document.createElement("option");
    fromOption.value = String(i);
    fromOption.textContent = text;
    fromTimeIndexEl.appendChild(fromOption);

    const watchOption = document.createElement("option");
    watchOption.value = String(i);
    watchOption.textContent = text;
    watchStartIndexEl.appendChild(watchOption);
  }
})();

loadSettings().catch(() => setStatus("Failed to load settings.", true));
