let username = "isafder";
let password = "YLpHiR";
let numberOfCourts = 2;
let toTime = ["702000000000", "720000000000", "738000000000"]; //"738000000000" is till 20:30
let timeLimit = 27; // till 20:30 column
let startingDay;

async function checkCondition() {

    if ($("#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_ddlTimeTo").val() == "0") {
        $("#ctl00_workspace_dpWindow_mpDynamicPopup_btClose").click();
    }

    if ($("#ctl00_toolboxRight_tbLoginUserName").length) {
        $("#ctl00_toolboxRight_tbLoginUserName").val(username);
        $("#ctl00_toolboxRight_tbLoginPassword").val(password);
        $("#ctl00_toolboxRight_btLogin").click();
    } else {
        startingDay = 2;
        if (new Date().getHours() > 1 && new Date().getHours() < 18) { // check for the next day only before 6pm on current day
            startingDay = 1;
        }
        
        for (let i = startingDay; i < 16; i++) {
            let dayToCheck = $(`#rgDL_${i}`).text().trim();
            if (dayToCheck.indexOf("So") >= 0 || dayToCheck.indexOf("Ne") >= 0 || dayToCheck.indexOf("Po") >= 0) {
                continue;
            }

            for (let j = 23; j < timeLimit; j++) {
                let timeToCheck = `rgI_${i}_${j}`;
                if (!$(`#${timeToCheck}`).length || $(`#${timeToCheck}`).text().trim() == "") {
                    continue;
                }

                const stillNeedToCheck = parseInt($(`#${timeToCheck} span.rgi-custres`).text().trim() == "" ? 0 : $(`#${timeToCheck} span.rgi-custres`).text().trim()) < numberOfCourts;
                if (stillNeedToCheck && $(`#${timeToCheck} span.rgi-freeres`).text().trim() != "") {
                    console.log("Condition not met, running script again.");
                    $(`#${timeToCheck}`).click();
                    while (!$("#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_btReserve")?.length) {
                        await timer(1000);
                    }

                    let toTimeFound = false; let toTimeIndex = 2; let minIndex = 4 - (timeLimit - j);
                    if (j === 27) {
                        minIndex = 2;
                    }

                    while(!toTimeFound && toTimeIndex >= minIndex) {
                        if ($(`#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_ddlTimeTo option[value='${toTime[toTimeIndex]}']`).length > 0) {
                            $("#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_ddlTimeTo").val(toTime[toTimeIndex]);
                            toTimeFound = true;
                            break;
                        }
                        toTimeIndex--;
                    }

                    await timer(200);
                    $("#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_btReserve").click();
                    while ($("#ctl00_workspace_dpWindow_mpDynamicPopup_ctl01_dpcf_popupforms_resedit_ascx_btReserve").length) {
                        await timer(1000);
                    }
                    j--;
                }
            }
        }
    }
    await timer(2500);
    location.href = location.href;
}

// This function will be called when the page has fully loaded
function onPageLoad() {
  console.log("Page loaded. Starting script.");
  // Start checking the condition every second
  setTimeout(checkCondition, 1000);
}

// Listen for the DOMContentLoaded event to run the script
document.addEventListener("DOMContentLoaded", onPageLoad);

// Call the function when the window is loaded
window.addEventListener("load", onPageLoad);

const timer = ms => new Promise(res => setTimeout(res, ms));