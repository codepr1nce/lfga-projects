function getCookie(name) {
    var value = "; " + document.cookie;
    var parts = value.split("; " + name + "=");
    if (parts.length === 2) {
        return parts.pop().split(";").shift();
    }
}

var campaignID = "";
var cachebuster = Math.round(new Date().getTime() / 1000);
var rtkClickID;
var rtkfbp = getCookie('_fbp') || '';
var rtkfbc = getCookie('_fbc') || '';
var locSearch = window.location.search;
var urlParams = new URLSearchParams(locSearch);
var pixelParams = "&" + locSearch.substr(1) + "&sub19=" + rtkfbp + "&sub20=" + rtkfbc
if (campaignID == "") {
    campaignID = urlParams.get('rtkcmpid')
}
var initialSrc = "https://lp.ingresaconvideos.com/" + campaignID + "?format=json";

function stripTrailingSlash(str) {
    return str.replace(/\/$/, "");
}

var rawData;

function fixHrefWithClick(
    _rawData,
    _cachebuster,
    _rtkClickID
) {
    document.querySelectorAll('a').forEach(function (el) {
        if (el.href.indexOf("lp.ingresaconvideos.com/click") > -1) {
            if (el.href.indexOf('?') > -1) {
                el.href = stripTrailingSlash(el.href) + "&clickid=" + (_rtkClickID || _rawData.clickid) + "&rtkck=" + _cachebuster
            } else {
                el.href = stripTrailingSlash(el.href) + "?clickid=" + (_rtkClickID || _rawData.clickid) + "&rtkck=" + _cachebuster
            }
        }
        if (el.href.indexOf("clickid={clickid}") > -1) {
            el.href = el.href.replace(/{clickid}/, _rawData.clickid) + "&rtkck=" + _cachebuster;
        }
    });
}

setTimeout(function () {
    if (!urlParams.get('rtkcid')) {
        xhr = new XMLHttpRequest;
        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4 && xhr.status == 200) {
                rawData = JSON.parse(xhr.responseText);
                rtkClickID = rawData.clickid
                setCookie();
                // fixHrefWithClick(rawData, cachebuster)
                document.querySelectorAll('a').forEach(function (el) {
                    if (el.href.indexOf("lp.ingresaconvideos.com/click") > -1) {
                        if (el.href.indexOf('?') > -1) {
                            el.href = stripTrailingSlash(el.href) + "&clickid=" + rawData.clickid + "&rtkck=" + cachebuster
                        } else {
                            el.href = stripTrailingSlash(el.href) + "?clickid=" + rawData.clickid + "&rtkck=" + cachebuster
                        }
                    }
                    if (el.href.indexOf("clickid={clickid}") > -1) {
                        el.href = el.href.replace(/{clickid}/, rawData.clickid) + "&rtkck=" + cachebuster;
                    }
                });
                xhrr = new XMLHttpRequest;
                xhrr.open("GET", "https://lp.ingresaconvideos.com/view?clickid=" + rawData.clickid)
                xhrr.send();
            }
        }
        xhr.open("GET", initialSrc + pixelParams)
        xhr.send();
    } else {
        rtkClickID = urlParams.get('rtkcid')
        setCookie();
        xhrTrack = new XMLHttpRequest;
        xhrTrack.open("GET", "https://lp.ingresaconvideos.com/view?clickid=" + rtkClickID)
        xhrTrack.send();
        // fixHrefWithClick(rawData, cachebuster, rtkClickID)
        document.querySelectorAll('a').forEach(function (el) {
            if (el.href.indexOf("lp.ingresaconvideos.com/click") > -1) {
                if (el.href.indexOf('?') > -1) {
                    el.href = stripTrailingSlash(el.href) + "&clickid=" + rtkClickID + "&rtkck=" + cachebuster
                } else {
                    el.href = stripTrailingSlash(el.href) + "?clickid=" + rtkClickID + "&rtkck=" + cachebuster
                }
            }
            if (el.href.indexOf("clickid={clickid}") > -1) {
                el.href = el.href.replace(/{clickid}/, rawData.clickid) + "&rtkck=" + cachebuster;
            }
        });
    }
}, 5e1)

function setCookie() {
    var cookieName = "rtkclickid-store", cookieValue = rtkClickID, expirationTime = 86400 * 30 * 1000,
        date = new Date(), dateTimeNow = date.getTime();
    date.setTime(dateTimeNow + expirationTime);
    var date = date.toUTCString();
    document.cookie = cookieName + "=" + cookieValue + "; expires=" + date + "; path=/;"
}