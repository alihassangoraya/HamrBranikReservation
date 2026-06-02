const DEFAULT_SETTINGS = {
  username: "hsaini1",
  password: "T20d12",
  numberOfCourts: 2,
  fromTimeIndex: 23,
  endTimeIndex: 27
};

const REQUIRED_DURATION_SLOTS = 4;
const extApi = typeof browser !== "undefined" ? browser : chrome;

const usernameEl = document.getElementById("username");
const passwordEl = document.getElementById("password");
const numberOfCourtsEl = document.getElementById("numberOfCourts");
const allowedDaysEl = document.getElementById("allowedDays");
const fromTimeIndexEl = document.getElementById("fromTimeIndex");
const endTimeIndexEl = document.getElementById("endTimeIndex");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b00020" : "#0a7b2d";
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
  const fromTimeIndex = Number(settings.fromTimeIndex ?? DEFAULT_SETTINGS.fromTimeIndex);
  const endTimeIndex = Number(settings.endTimeIndex ?? (fromTimeIndex + REQUIRED_DURATION_SLOTS));
  fromTimeIndexEl.value = String(fromTimeIndex);
  endTimeIndexEl.value = String(endTimeIndex);
}

async function loadSettings() {
  const settings = await storageGet(["username", "password", "numberOfCourts", "allowedDays", "fromTimeIndex", "endTimeIndex"]);
  fillForm(settings);
}

async function saveSettings() {
  const fromTimeIndex = Math.max(0, Number(fromTimeIndexEl.value) || 23);
  const endTimeIndex = Math.min(32, Math.max(1, Number(endTimeIndexEl.value) || (fromTimeIndex + REQUIRED_DURATION_SLOTS)));
  const durationSlots = endTimeIndex - fromTimeIndex;

  const payload = {
    username: usernameEl.value.trim(),
    password: passwordEl.value,
    numberOfCourts: Math.min(2, Math.max(1, Number(numberOfCourtsEl.value) || DEFAULT_SETTINGS.numberOfCourts)),
    allowedDays: Array.from(allowedDaysEl.selectedOptions).map((opt) => opt.value),
    fromTimeIndex,
    endTimeIndex
  };

  if (!payload.username || !payload.password) {
    setStatus("Username and password are required.", true);
    return;
  }
  if (!payload.allowedDays.length) {
    setStatus("Please select at least one day.", true);
    return;
  }
  if (durationSlots < REQUIRED_DURATION_SLOTS) {
    setStatus("End time must be at least 120 minutes after start time.", true);
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
  }

  for (let i = 1; i <= 32; i++) {
    const totalMinutes = 7 * 60 + i * 30;
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    const text = `${hh}:${mm}`;

    const endOption = document.createElement("option");
    endOption.value = String(i);
    endOption.textContent = text;
    endTimeIndexEl.appendChild(endOption);
  }

})();

loadSettings().catch(() => setStatus("Failed to load settings.", true));
