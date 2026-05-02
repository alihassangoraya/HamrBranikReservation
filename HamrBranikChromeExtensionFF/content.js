const DEFAULT_SETTINGS = {
    username: "hsaini1",
    password: "T20d12",
    numberOfCourts: 2,
    toTime: ["702000000000", "720000000000", "738000000000"],
    timeLimit: 27
};

const extApi = typeof browser !== "undefined" ? browser : chrome;
let startingDay;
const MAX_BOOKINGS_PER_SLOT = 2;
const CHECK_INTERVAL_MS = 1200;
const TURBO_CHECK_INTERVAL_MS = 700;
const GRID_REFRESH_INTERVAL_MS = 15000;
const FREE_CANCEL_BUFFER_MS = (24 * 60 + 30) * 60 * 1000; // 24h 30m

let isRunning = false;
let scheduledRun = null;
let loginInProgressUntil = 0;
let lastGridRefreshAt = 0;
const RESERVE_BUTTON_ID = "ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_btReserve";
const TIME_TO_SELECT_ID = "ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_ddlTimeTo";
const POPUP_PANEL_ID = "ctl00_workspace_dpWindow_mpDynamicPopup_pnlModalPopup";

function parseTimeToMinutes(hhmm) {
    const parts = hhmm.split(":").map(Number);
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
}

async function waitForReserveButtonReady(timeoutMs = 1200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const btn = document.getElementById(RESERVE_BUTTON_ID);
        if (btn && !btn.disabled && $(btn).is(":visible")) {
            return true;
        }
        await timer(50);
    }
    return false;
}

async function waitForDurationSelectReady(timeoutMs = 1200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const select = document.getElementById(TIME_TO_SELECT_ID);
        if (select && $(`#${TIME_TO_SELECT_ID} option`).length > 1 && $(select).is(":visible")) {
            return true;
        }
        await timer(50);
    }
    return false;
}

function isPopupOpen() {
    const panel = document.getElementById(POPUP_PANEL_ID);
    return !!(panel && $(panel).is(":visible"));
}

async function waitForPopupOpen(timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (isPopupOpen()) return true;
        await timer(50);
    }
    return false;
}

async function waitForPopupClose() {
    while (isPopupOpen() || $(`#${RESERVE_BUTTON_ID}`).length) {
        await timer(100);
    }
}

function getCurrentScanIntervalMs() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const turboStart = parseTimeToMinutes("21:58");
    const turboEnd = parseTimeToMinutes("22:10");

    if (turboStart === null || turboEnd === null) {
        return CHECK_INTERVAL_MS;
    }
    return currentMinutes >= turboStart && currentMinutes <= turboEnd
        ? TURBO_CHECK_INTERVAL_MS
        : CHECK_INTERVAL_MS;
}

function storageGet(keys) {
    return new Promise((resolve) => {
        try {
            const result = extApi.storage.local.get(keys, (items) => {
                resolve(items || {});
            });
            if (result && typeof result.then === "function") {
                result.then((items) => resolve(items || {})).catch(() => resolve({}));
            }
        } catch (e) {
            resolve({});
        }
    });
}

function parseToTime(rawValue) {
    if (Array.isArray(rawValue) && rawValue.length) {
        return rawValue.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof rawValue === "string") {
        return rawValue.split(",").map((v) => v.trim()).filter(Boolean);
    }
    return [...DEFAULT_SETTINGS.toTime];
}

function getSlotStartDate(dayLabel, slotIndex) {
    const match = dayLabel.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const minutesFromStart = (7 * 60) + (slotIndex * 30);
    const hour = Math.floor(minutesFromStart / 60);
    const minute = minutesFromStart % 60;

    return new Date(year, month, day, hour, minute, 0, 0);
}

async function loadSettings() {
    const stored = await storageGet(["username", "password", "numberOfCourts", "toTime", "timeLimit", "allowedDays", "fromTimeIndex", "enableLastMinuteWatch", "watchDay", "watchStartIndex", "watchDurationSlots"]);
    return {
        username: (stored.username ?? DEFAULT_SETTINGS.username).toString(),
        password: (stored.password ?? DEFAULT_SETTINGS.password).toString(),
        numberOfCourts: Number(stored.numberOfCourts ?? DEFAULT_SETTINGS.numberOfCourts),
        toTime: parseToTime(stored.toTime ?? DEFAULT_SETTINGS.toTime),
        timeLimit: Number(stored.timeLimit ?? DEFAULT_SETTINGS.timeLimit),
        allowedDays: Array.isArray(stored.allowedDays) && stored.allowedDays.length ? stored.allowedDays : ["Út", "St", "Čt", "Pá"],
        fromTimeIndex: Number(stored.fromTimeIndex ?? 23),
        enableLastMinuteWatch: Boolean(stored.enableLastMinuteWatch),
        watchDay: (stored.watchDay ?? "Pá").toString(),
        watchStartIndex: Number(stored.watchStartIndex ?? 23),
        watchDurationSlots: Number(stored.watchDurationSlots ?? 1)
    };
}

async function checkCondition() {
    if (isRunning) {
        scheduleNextRun(1500);
        return;
    }
    if (Date.now() < loginInProgressUntil) {
        scheduleNextRun(1000);
        return;
    }
    isRunning = true;
    let didAnyAction = false;

    try {

    const { username, password, numberOfCourts, toTime, timeLimit, allowedDays, fromTimeIndex, enableLastMinuteWatch, watchDay, watchStartIndex, watchDurationSlots } = await loadSettings();
    const effectiveTargetPerSlot = Math.min(Number(numberOfCourts) || 0, MAX_BOOKINGS_PER_SLOT);

    if ($("#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_ddlTimeTo").val() == "0") {
        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
    }

    const topLoginUser = $("#ctl00_userNavRight_tbLoginUserName:visible, #ctl00_toolboxRight_tbLoginUserName:visible");
    const topLoginPass = $("#ctl00_userNavRight_tbLoginPassword:visible, #ctl00_toolboxRight_tbLoginPassword:visible");
    const topLoginBtn = $("#ctl00_userNavRight_btLogin:visible, #ctl00_toolboxRight_btLogin:visible");

    const popupLoginUser = $("#ctl00_workspace_mpLogOn_ctl00_tbLogOnUser:visible");
    const popupLoginPass = $("#ctl00_workspace_mpLogOn_ctl00_tbLogOnPassword:visible");
    const popupLoginBtn = $("#ctl00_workspace_mpLogOn_ctl00_btLogOn:visible");

    const isLoggedIn = $("#ctl00_userNavRight_lbLogout:visible").length > 0;

    if (isLoggedIn) {
        loginInProgressUntil = 0;
    } else if (topLoginUser.length && topLoginPass.length && topLoginBtn.length) {
        topLoginUser.val(username);
        topLoginPass.val(password);
        topLoginBtn.click();
        didAnyAction = true;
        loginInProgressUntil = Date.now() + 12000;
    } else if (popupLoginUser.length && popupLoginPass.length && popupLoginBtn.length) {
        popupLoginUser.val(username);
        popupLoginPass.val(password);
        popupLoginBtn.click();
        didAnyAction = true;
        loginInProgressUntil = Date.now() + 12000;
    } else if ($("#ctl00_workspace_mpLogOn_pnlModalPopup:visible").length) {
        loginInProgressUntil = Date.now() + 12000;
    }

    if (isLoggedIn) {
        startingDay = 2;
        if (new Date().getHours() > 1 && new Date().getHours() < 18) { // check for the next day only before 6pm on current day
            startingDay = 1;
        }
        
        const totalRows = $("[id^='rgDL_']").length;
        for (let i = startingDay; i < totalRows; i++) {
            let dayToCheck = $(`#rgDL_${i}`).text().trim();
            const dayShort = dayToCheck.split(" ")[0];
            const watchEndIndex = watchStartIndex + watchDurationSlots - 1;

            for (let j = fromTimeIndex; j <= timeLimit; j++) {
                const slotStart = getSlotStartDate(dayToCheck, j);
                if (!slotStart || slotStart.getTime() <= Date.now()) {
                    continue;
                }

                const isWatchTarget =
                    enableLastMinuteWatch &&
                    dayShort === watchDay &&
                    j >= watchStartIndex &&
                    j <= watchEndIndex;

                if (!allowedDays.includes(dayShort) && !isWatchTarget) {
                    continue;
                }

                if (!isWatchTarget && (slotStart.getTime() - Date.now()) < FREE_CANCEL_BUFFER_MS) {
                    continue;
                }

                let timeToCheck = `rgI_${i}_${j}`;
                const $slot = $(`#${timeToCheck}`);
                if (!$slot.length || $slot.text().trim() == "") {
                    continue;
                }

                const reservedCountText = $slot.find("span.rgi-custres").text().trim();
                const reservedCount = parseInt(reservedCountText === "" ? "0" : reservedCountText, 10);
                const freeLabel = $slot.find("span.rgi-freeres").text().trim();
                const hasFreeCapacity = freeLabel !== "";
                const stillNeedToCheck = reservedCount < effectiveTargetPerSlot;

                if (stillNeedToCheck && hasFreeCapacity) {
                    console.log("Condition not met, running script again.");
                    $slot.click();
                    didAnyAction = true;

                    const popupOpened = await waitForPopupOpen(2000);
                    if (!popupOpened) {
                        continue;
                    }

                    const durationReady = await waitForDurationSelectReady(1200);
                    if (!durationReady) {
                        console.warn("Duration select not ready in time; closing popup.");
                        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
                        continue;
                    }

                    let toTimeFound = false; let toTimeIndex = 2; let minIndex = 4 - (timeLimit - j);
                    if (j === 27) {
                        minIndex = 2;
                    }

                    const currentTimeToValue = $(`#${TIME_TO_SELECT_ID}`).val();
                    while(!toTimeFound && toTimeIndex >= minIndex) {
                        if ($(`#${TIME_TO_SELECT_ID} option[value='${toTime[toTimeIndex]}']`).length > 0) {
                            $(`#${TIME_TO_SELECT_ID}`).val(toTime[toTimeIndex]);
                            $(`#${TIME_TO_SELECT_ID}`).trigger("change");
                            toTimeFound = true;
                            break;
                        }
                        toTimeIndex--;
                    }

                    if (!toTimeFound) {
                        console.warn("No matching end-time option found for this slot; closing popup.");
                        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
                        continue;
                    }

                    await timer(0);
                    const reserveReady = await waitForReserveButtonReady(1500);
                    if (!reserveReady) {
                        console.warn("Reserve button not ready after end-time update; skipping this attempt.");
                        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
                        continue;
                    }

                    const latestReservedBeforeClick = parseInt(($(`#${timeToCheck}`).find("span.rgi-custres").text().trim() || "0"), 10);
                    if (latestReservedBeforeClick >= effectiveTargetPerSlot) {
                        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
                        continue;
                    }

                    document.getElementById(RESERVE_BUTTON_ID)?.click();
                    didAnyAction = true;
                    await waitForPopupClose();
                    await timer(150);
                    const $slotAfter = $(`#${timeToCheck}`);
                    const reservedAfter = parseInt(($slotAfter.find("span.rgi-custres").text().trim() || "0"), 10);
                    const hasFreeAfter = $slotAfter.find("span.rgi-freeres").text().trim() !== "";
                    if (reservedAfter > reservedCount && reservedAfter < effectiveTargetPerSlot && hasFreeAfter) {
                        // Re-check same slot after successful booking to fill remaining court(s).
                        j--;
                    }
                }
            }
        }

        if (!didAnyAction && !isPopupOpen() && (Date.now() - lastGridRefreshAt) > GRID_REFRESH_INTERVAL_MS) {
            lastGridRefreshAt = Date.now();
            window.location.reload();
            return;
        }
    }
    } finally {
        isRunning = false;
        scheduleNextRun(getCurrentScanIntervalMs());
    }
}

// This function will be called when the page has fully loaded
function onPageLoad() {
  console.log("Page loaded. Starting script.");
  // Start checking the condition every second
  scheduleNextRun(1000);
}

function scheduleNextRun(delayMs) {
  if (scheduledRun) {
    clearTimeout(scheduledRun);
  }
  scheduledRun = setTimeout(checkCondition, delayMs);
}

if (!window.__hamrScriptStarted) {
  window.__hamrScriptStarted = true;
  // Listen for the DOMContentLoaded event to run the script
  document.addEventListener("DOMContentLoaded", onPageLoad);

  // Call the function when the window is loaded
  window.addEventListener("load", onPageLoad);
}

const timer = ms => new Promise(res => setTimeout(res, ms));