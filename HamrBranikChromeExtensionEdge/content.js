const DEFAULT_SETTINGS = {
    username: "dcretaro",
    password: "internet",
    numberOfCourts: 2
};

const extApi = typeof browser !== "undefined" ? browser : chrome;
const MAX_BOOKINGS_PER_SLOT = 2;
const CHECK_INTERVAL_MS = 1200;
const TURBO_CHECK_INTERVAL_MS = 700;
const GRID_REFRESH_INTERVAL_MS = 15000;
const RESERVATION_VALUE_PER_MINUTE = 600000000;
const REQUIRED_DURATION_SLOTS = 4; // 2 hours

let isRunning = false;
let scheduledRun = null;
let loginInProgressUntil = 0;
let lastGridRefreshAt = 0;
const sessionReservedCounts = new Map();
const REQUIRED_LOCALITY = "Braník";
const REQUIRED_SPORT = "Badminton";
const LOCALITY_SELECT_ID = "ctl00_workspace_ddlLocality";
const SPORT_SELECT_ID = "ctl00_workspace_ddlSport";
const RESERVE_BUTTON_ID = "ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_btReserve";
const TIME_TO_SELECT_ID = "ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_ddlTimeTo";
const POPUP_PANEL_ID = "ctl00_workspace_dpWindow_mpDynamicPopup_pnlModalPopup";

function parseTimeToMinutes(hhmm) {
    const parts = hhmm.split(":").map(Number);
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
}

function getDayStartDate(dayLabel) {
    const match = dayLabel.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    return new Date(year, month, day, 0, 0, 0, 0);
}

function isSameCalendarDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function isTomorrow(dayDate, now = new Date()) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return isSameCalendarDay(dayDate, tomorrow);
}

function shouldScanDay(dayLabel, allowedDays, now = new Date()) {
    const dayShort = dayLabel.split(" ")[0];
    const dayDate = getDayStartDate(dayLabel);
    return !!dayDate && allowedDays.includes(dayShort) && !isTomorrow(dayDate, now);
}

function getSlotKey(dayLabel, slotIndex) {
    return `${dayLabel}|${slotIndex}`;
}

function getKnownReservedCount(slotKey, domReservedCount) {
    const safeDomCount = Number.isFinite(domReservedCount) ? domReservedCount : 0;
    return Math.max(safeDomCount, sessionReservedCounts.get(slotKey) || 0);
}

function noteReservationSubmit(slotKey, baselineCount) {
    const nextCount = Math.min(MAX_BOOKINGS_PER_SLOT, getKnownReservedCount(slotKey, baselineCount) + 1);
    sessionReservedCounts.set(slotKey, nextCount);
    return nextCount;
}

function getSelectedOptionText(selectId) {
    return $(`#${selectId} option:selected`).text().trim();
}

function selectOptionByText(selectId, text) {
    const $select = $(`#${selectId}`);
    if (!$select.length) return false;

    const option = $select.find("option").filter(function () {
        return $(this).text().trim() === text;
    }).first();

    if (!option.length) return false;
    if (getSelectedOptionText(selectId) === text) return true;

    $select.val(option.val());
    $select.trigger("change");
    return false;
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function getEndTimeValue(endTimeIndex) {
    const endMinutes = (7 * 60) + (endTimeIndex * 30);
    return String(endMinutes * RESERVATION_VALUE_PER_MINUTE);
}

function getTargetTimeWindow(fromTimeIndex, endTimeIndex) {
    const startIndex = clampNumber(fromTimeIndex, 0, 31, 23);
    const endIndex = clampNumber(endTimeIndex, 1, 32, startIndex + REQUIRED_DURATION_SLOTS);
    if (endIndex - startIndex < REQUIRED_DURATION_SLOTS) return null;
    return { startIndex, endIndex, lastStartIndex: endIndex - REQUIRED_DURATION_SLOTS };
}

function selectExactEndTime(endTimeIndex) {
    const $select = $(`#${TIME_TO_SELECT_ID}`);
    if (!$select.length) return false;

    const value = getEndTimeValue(endTimeIndex);
    if ($select.find(`option[value='${value}']`).length > 0) {
        $select.val(value);
        $select.trigger("change");
        return true;
    }

    return false;
}

function ensureBadmintonContext() {
    if ($(`#${LOCALITY_SELECT_ID}`).length && !selectOptionByText(LOCALITY_SELECT_ID, REQUIRED_LOCALITY)) {
        return false;
    }

    if ($(`#${SPORT_SELECT_ID}`).length && !selectOptionByText(SPORT_SELECT_ID, REQUIRED_SPORT)) {
        return false;
    }

    return getSelectedOptionText(LOCALITY_SELECT_ID) === REQUIRED_LOCALITY
        && getSelectedOptionText(SPORT_SELECT_ID) === REQUIRED_SPORT;
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
        if (select && $(`#${TIME_TO_SELECT_ID} option`).length > 0 && $(select).is(":visible")) {
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

async function waitForPopupClose(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs && (isPopupOpen() || $(`#${RESERVE_BUTTON_ID}:visible`).length)) {
        await timer(100);
    }
    return !isPopupOpen() && $(`#${RESERVE_BUTTON_ID}:visible`).length === 0;
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

function getSlotStartDate(dayLabel, slotIndex) {
    const dayDate = getDayStartDate(dayLabel);
    if (!dayDate) return null;

    const minutesFromStart = (7 * 60) + (slotIndex * 30);
    const hour = Math.floor(minutesFromStart / 60);
    const minute = minutesFromStart % 60;

    return new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, minute, 0, 0);
}

async function loadSettings() {
    const stored = await storageGet(["username", "password", "numberOfCourts", "allowedDays", "fromTimeIndex", "endTimeIndex"]);
    const fromTimeIndex = Number(stored.fromTimeIndex ?? 23);
    const endTimeIndex = Number(stored.endTimeIndex ?? (fromTimeIndex + REQUIRED_DURATION_SLOTS));
    return {
        username: (stored.username ?? DEFAULT_SETTINGS.username).toString(),
        password: (stored.password ?? DEFAULT_SETTINGS.password).toString(),
        numberOfCourts: Number(stored.numberOfCourts ?? DEFAULT_SETTINGS.numberOfCourts),
        allowedDays: Array.isArray(stored.allowedDays) && stored.allowedDays.length ? stored.allowedDays : ["Út", "St", "Čt", "Pá"],
        fromTimeIndex,
        endTimeIndex
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

    const { username, password, numberOfCourts, allowedDays, fromTimeIndex, endTimeIndex } = await loadSettings();
    const targetWindow = getTargetTimeWindow(fromTimeIndex, endTimeIndex);
    const effectiveTargetPerSlot = Math.min(Math.max(Number(numberOfCourts) || 1, 1), MAX_BOOKINGS_PER_SLOT);
    if (!targetWindow) {
        console.warn("Invalid target time window; booking requires at least 2 hours.");
        return;
    }

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
        if (!ensureBadmintonContext()) {
            didAnyAction = true;
            return;
        }

        const scanStartedAt = new Date();
        const totalRows = $("[id^='rgDL_']").length;
        for (let i = 0; i < totalRows; i++) {
            let dayToCheck = $(`#rgDL_${i}`).text().trim();
            const isSelectedBookingDay = shouldScanDay(dayToCheck, allowedDays, scanStartedAt);

            if (!isSelectedBookingDay) {
                continue;
            }

            for (let j = targetWindow.startIndex; j <= targetWindow.lastStartIndex; j++) {
                const slotStart = getSlotStartDate(dayToCheck, j);
                if (!slotStart || slotStart.getTime() <= Date.now()) {
                    continue;
                }

                let timeToCheck = `rgI_${i}_${j}`;
                const slotKey = getSlotKey(dayToCheck, j);
                const $slot = $(`#${timeToCheck}`);
                if (!$slot.length || $slot.text().trim() == "") {
                    continue;
                }

                const reservedCountText = $slot.find("span.rgi-custres").text().trim();
                const domReservedCount = parseInt(reservedCountText === "" ? "0" : reservedCountText, 10);
                const reservedCount = getKnownReservedCount(slotKey, domReservedCount);
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

                    if (!selectExactEndTime(j + REQUIRED_DURATION_SLOTS)) {
                        console.warn("Exact 2-hour end-time option not available for this slot; closing popup.");
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

                    const latestReservedBeforeClick = getKnownReservedCount(
                        slotKey,
                        parseInt(($(`#${timeToCheck}`).find("span.rgi-custres").text().trim() || "0"), 10)
                    );
                    if (latestReservedBeforeClick >= effectiveTargetPerSlot) {
                        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
                        continue;
                    }

                    document.getElementById(RESERVE_BUTTON_ID)?.click();
                    noteReservationSubmit(slotKey, latestReservedBeforeClick);
                    didAnyAction = true;
                    const popupClosed = await waitForPopupClose();
                    if (!popupClosed) {
                        console.warn("Reservation popup did not close after submit; closing it to keep scanner running.");
                        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
                        await timer(300);
                    }
                    await timer(150);
                    const $slotAfter = $(`#${timeToCheck}`);
                    const reservedAfter = getKnownReservedCount(
                        slotKey,
                        parseInt(($slotAfter.find("span.rgi-custres").text().trim() || "0"), 10)
                    );
                    const hasFreeAfter = $slotAfter.find("span.rgi-freeres").text().trim() !== "";
                    if (reservedAfter > reservedCount && reservedAfter < effectiveTargetPerSlot && hasFreeAfter) {
                        // Re-check same slot after successful booking to fill remaining court(s).
                        j--;
                    }
                }
            }
        }

        if (!isPopupOpen() && (Date.now() - lastGridRefreshAt) > GRID_REFRESH_INTERVAL_MS) {
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
