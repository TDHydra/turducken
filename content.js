// Default list of male actors. We will sync this with Chrome's local storage.
const DEFAULT_EXCLUDED_ACTORS = [
    "elias cash",
    "johnny sins",
    "j-mac",
    "keiran lee",
    "mick blue",
    "charles dera",
    "mike adriano"
];

let currentExcludedActors = [];
let isProcessing = false;

// Custom logging function
const logDebug = (msg, data = null) => {
    const prefix = "🚀 [Reptyle DEBUG]";
    if (data) {
        console.log(`${prefix} ${msg}`, data);
    } else {
        console.log(`${prefix} ${msg}`);
    }
};
const isMovieDetailUrl = (href = window.location.href) => {
    logDebug("isMovieDetailUrl() called with href:", href);

    try {
        const { pathname } = new URL(href, window.location.origin);
        const isMatch = /^\/movies\/\d+\/?$/.test(pathname);

        logDebug(`isMovieDetailUrl() parsed pathname='${pathname}', result=${isMatch}`);
        return isMatch;
    } catch (err) {
        logDebug("isMovieDetailUrl() failed to parse URL:", err);
        return false;
    }
};
// Initialize the exclude list from storage
const loadExcludedActors = () => {
    return new Promise((resolve) => {
        chrome.storage.local.get(['excludedActors'], (result) => {
            if (result.excludedActors && Array.isArray(result.excludedActors)) {
                currentExcludedActors = result.excludedActors;
            } else {
                currentExcludedActors = [...DEFAULT_EXCLUDED_ACTORS];
                chrome.storage.local.set({ excludedActors: currentExcludedActors });
            }
            logDebug("Loaded excluded actors:", currentExcludedActors);
            resolve();
        });
    });
};

// Utility: Wait for an element to appear in the DOM
const waitAndFind = async (selector, pollInterval = 1000, maxRetries = 30) => {
    logDebug(`Starting search for selector: '${selector}'`);
    for (let i = 0; i < maxRetries; i++) {
        const el = document.querySelector(selector);
        if (el) {
            logDebug(`SUCCESS: Found element '${selector}' on attempt ${i + 1}`);
            return el;
        }
        logDebug(`Waiting for '${selector}'... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    console.warn(`🚀 [Reptyle DEBUG] TIMEOUT: Could not find '${selector}' after ${maxRetries} attempts.`);
    return null;
};

// Utility: Pause script execution explicitly
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Intercept clicks on the page (for actor exclusion and thumbnail navigation)
document.addEventListener('click', async (e) => {
    // 1. Intercept Actor Link Clicks
    const actorLink = e.target.closest('a[href*="/models/"]');
    if (actorLink) {
        e.preventDefault();
        e.stopPropagation(); // Stop the site from navigating immediately
        
        const actorName = actorLink.innerText.replace(/,/g, '').trim();
        if (!actorName) return;

        const isExcluded = currentExcludedActors.some(a => a.toLowerCase() === actorName.toLowerCase());
        
        if (isExcluded) {
            if (confirm(`"${actorName}" is already on your exclude list.\n\nDo you want to REMOVE them from the list?`)) {
                currentExcludedActors = currentExcludedActors.filter(a => a.toLowerCase() !== actorName.toLowerCase());
                chrome.storage.local.set({ excludedActors: currentExcludedActors });
                logDebug(`Removed "${actorName}" from exclude list.`);
            } else {
                window.location.href = actorLink.href; // Proceed to page if they just wanted to visit it
            }
        } else {
            if (confirm(`Do you want to ADD "${actorName}" to your EXCLUDED actors list so they don't appear in filenames?`)) {
                currentExcludedActors.push(actorName);
                chrome.storage.local.set({ excludedActors: currentExcludedActors });
                logDebug(`Added "${actorName}" to exclude list.`);
            } else {
                window.location.href = actorLink.href; // Proceed to page if they clicked cancel
            }
        }
        return;
    }

    // 2. Intercept Movie Thumbnail Clicks to trigger the automation
    const movieLink = e.target.closest('a[href*="/movies/"]');
    if (movieLink) {
        logDebug("Movie thumbnail clicked! Waiting for page to route, then starting automation...");
        // Wait 2 seconds for the SPA to change the URL and DOM, then start
        setTimeout(() => {
            startAutomatedProcess();
        }, 2000);
    }
}, true); // useCapture = true ensures we intercept before React handles the click

async function startAutomatedProcess() {
    // Guard clauses to prevent double-runs or running on the main grid page
    if (isProcessing) {
        logDebug("Already processing a download. Skipping trigger.");
        return;
    }
    if (!window.location.href.includes('/movies/')) {
        logDebug("Not currently on a movie page. Automation sleeping.");
        return;
    }

    isProcessing = true;
    logDebug("Reptyle Auto Downloader: Starting robust extraction process...");

    try {
        // 1. Wait for the page structure to fully load by looking for the series logo
        logDebug("Step 1: Waiting for page structure (.series-logo)");
        await waitAndFind('.series-logo'); 

        // 1.5 Extract Title and Network FIRST before clicking anything
        logDebug("Step 1.5: Grabbing Tab Title and Network Name...");
        
        // Poll for the Video Title until it is no longer the generic loading title
        let videoTitleRaw = document.title;
        let titleAttempts = 0;
        while ((videoTitleRaw.includes('Reptyle Members Area') || videoTitleRaw.trim() === 'Reptyle' || videoTitleRaw.trim() === '') && titleAttempts < 15) {
            logDebug(`Waiting for tab title to change from generic '${videoTitleRaw}'...`);
            await delay(1000);
            videoTitleRaw = document.title;
            titleAttempts++;
        }
        const videoTitle = videoTitleRaw.split(' - ')[0].split(' | ')[0].trim();
        logDebug(`Video Title: Raw='${videoTitleRaw}' -> Cleaned='${videoTitle}'`);

        // Grab the specific series alt text using the href pattern provided
        const seriesLogoImg = document.querySelector('.series-logo a[href*="/series/"] img');
        const networkTitle = seriesLogoImg ? ` ${seriesLogoImg.alt.trim()} ` : ' Unknown Network ';
        logDebug(`Network Title: Found via series link, Evaluated to '${networkTitle}'`);

        // 2. Click the "More" button to reveal the Date/Metadata
        logDebug("Step 2: Looking for 'More' button to reveal date.");
        const moreBtn = await waitAndFind('button[data-tooltip="More"]');
        if (moreBtn) {
            logDebug("Found 'More' button, clicking it now.");
            moreBtn.click();
            
            // Wait specifically for the date element to appear after clicking
            logDebug("Waiting for italic date element to appear...");
            const dateEl = await waitAndFind('div[style*="font-style: italic"]'); 
            logDebug("Date element detection result:", dateEl ? "Found!" : "Not Found!");
        } else {
            logDebug("WARNING: 'More' button not found!");
        }

        // 3. Extract the remaining metadata (Actors & Date)
        logDebug("Step 3: Extracting Date & Actors...");

        // Date
        const dateElement = document.querySelector('div[style*="font-style: italic"]');
        const uploadDate = dateElement ? dateElement.innerText.trim() : 'Unknown Date';
        logDebug(`Date: Evaluated to '${uploadDate}'`);

        // Actors
        const actorLinks = document.querySelectorAll('.movie-bg-player-model-container a[href*="/models/"]');
        logDebug(`Actors: Found ${actorLinks.length} actor links.`);
        
        let actorNames = Array.from(actorLinks).map((el, index) => {
            const cleaned = el.innerText.replace(/,/g, '').trim();
            logDebug(`  Actor [${index}] Node text: '${el.innerText}' -> Cleaned: '${cleaned}'`);
            return cleaned;
        }).filter(name => {
            if (name.length === 0) return false;
            
            // Check against dynamic storage list
            const isExcluded = currentExcludedActors.some(excluded => name.toLowerCase() === excluded.toLowerCase());
            if (isExcluded) {
                logDebug(`  Excluding actor from filename: '${name}'`);
                return false;
            }
            return true;
        });
        
        actorNames = [...new Set(actorNames)];
        const actorsFormatted = actorNames.join(' '); 
        logDebug(`Actors: Final formatted string -> '${actorsFormatted}'`);

        // 4. Find the Highest Quality Video URL
        logDebug("Step 4: Finding Highest Quality Video URL...");
        
        // First, click the button to open the download menu
        const downloadMenuBtn = await waitAndFind('button[data-tooltip="Download Full Movie"]');
        if (downloadMenuBtn) {
            logDebug("Found 'Download Full Movie' button, clicking it...");
            downloadMenuBtn.click();
            
            // Wait for the quality options to appear
            logDebug("Waiting for '.modal-download-button' options to appear...");
            await waitAndFind('.modal-download-button');
            await delay(500); // Small buffer for rendering animation
        } else {
            logDebug("WARNING: 'Download Full Movie' button not found!");
        }

        // Now grab all the quality links and pick the LAST one (Highest Quality)
        const qualityLinks = document.querySelectorAll('.modal-download-button');
        logDebug(`Quality Links: Found ${qualityLinks.length} quality options.`);
        let videoUrl = '';
        
        if (qualityLinks.length > 0) {
            // ALWAYS pick the last element in the array
            const highestQualityBtn = qualityLinks[qualityLinks.length - 1];
            logDebug("Selected Highest Quality Button HTML:", highestQualityBtn.outerHTML);
            logDebug(`Highest Quality Button Inner Text: '${highestQualityBtn.innerText.replace(/\n/g, ' ')}'`);
            
            // Try to extract an href if one exists on the button or a parent anchor
            videoUrl = highestQualityBtn.href || 
                       highestQualityBtn.getAttribute('data-url') || 
                       (highestQualityBtn.closest('a') ? highestQualityBtn.closest('a').href : '');
                       
            logDebug(`Extracted Direct URL (if any): '${videoUrl}'`);
            
            // If the site hides the URL and relies on a Javascript onClick to download:
            if (!videoUrl) {
                logDebug("No direct URL found on button. Preparing background script for NATIVE intercept...");
                
                const payload = { 
                    action: "prepareNativeDownload",
                    data: { 
                        network: networkTitle, 
                        title: videoTitle, 
                        actors: actorsFormatted, 
                        date: uploadDate 
                    }
                };
                logDebug("Sending native prep payload to background.js:", payload);
                
                // Tell the background script what to name the NEXT download that starts
                chrome.runtime.sendMessage(payload, async (response) => {
                    logDebug("Background script prep response received:", response);
                    
                    logDebug("Triggering native download via highestQualityBtn.click()...");
                    highestQualityBtn.click();
                    
                    logDebug("Waiting 4 seconds to ensure the site's JS completes the download request...");
                    await delay(4000); 
                    
                    logDebug("Executing window.history.back()");
                    window.history.back();
                });
                return; // Stop execution here so we don't send an empty URL to the fallback logic
            }
        } else {
            logDebug("WARNING: No quality links found via '.modal-download-button'. Trying video tag fallback...");
            // Fallback
            const videoTag = document.querySelector('video source, video');
            if (videoTag) {
                videoUrl = videoTag.src;
                logDebug(`Fallback video URL found: '${videoUrl}'`);
            } else {
                logDebug("Fallback video tag NOT found.");
            }
        }

        // 5. Send to background.js for standard direct download (if a URL was found)
        if (videoUrl) {
            logDebug("Direct URL ready. Sending direct download payload to background.js...");
            
            const payload = {
                action: "downloadVideo",
                data: { 
                    network: networkTitle, 
                    title: videoTitle, 
                    actors: actorsFormatted, 
                    date: uploadDate, 
                    url: videoUrl 
                }
            };
            logDebug("Payload:", payload);

            chrome.runtime.sendMessage(payload, (response) => {
                logDebug("Background script download response:", response);
                if (response && response.success) {
                    logDebug("Download started successfully. Navigating back...");
                    window.history.back();
                } else {
                    console.error("🚀 [Reptyle DEBUG] Download failed to start.", response);
                }
            });
        } else {
            console.error("🚀 [Reptyle DEBUG] CRITICAL ERROR: Download link not found and native intercept not triggered.");
        }
    } finally {
        // Ensure the lock is released if something goes wrong
        isProcessing = false;
    }
}

// Start the automation once the script injects (handles direct page loads or refreshes on a movie page)
loadExcludedActors().then(() => {
    startAutomatedProcess();
});