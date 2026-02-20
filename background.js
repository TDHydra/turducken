// This variable temporarily holds the filename we want to apply to the next download
let pendingFilename = "";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("🚀 [Reptyle BACKGROUND DEBUG] Received message action:", request.action);
    console.log("🚀 [Reptyle BACKGROUND DEBUG] Payload data:", request.data);

    // Helper to remove characters that Windows/Mac don't allow in file names
    const clean = (str) => {
        if (!str) return '';
        return str.replace(/[<>:"\/\\|?*]/g, '').trim();
    };

    try {
        // Handle intercepted native downloads (when there is no direct URL)
        if (request.action === "prepareNativeDownload") {
            console.log("🚀 [Reptyle BACKGROUND DEBUG] Processing native download prep...");
            const { network, title, actors, date } = request.data;
            const safeDate = clean(date).replace(/\//g, '-');
            
            // Build and store the filename in memory
            pendingFilename = `[${clean(network)}] - ${safeDate} - ${clean(title)} - ${clean(actors)}.mp4`;
            console.log("🚀 [Reptyle BACKGROUND DEBUG] Filename successfully built and stored in memory:", pendingFilename);
            
            // Send success back to content.js
            sendResponse({ success: true, nameReady: pendingFilename });
        }

        // Handle direct URL downloads (if a URL was successfully scraped)
        else if (request.action === "downloadVideo") {
            console.log("🚀 [Reptyle BACKGROUND DEBUG] Processing direct URL download...");
            const { network, title, actors, date, url } = request.data;
            const safeDate = clean(date).replace(/\//g, '-');
            const filename = `[${clean(network)}] - ${safeDate} - ${clean(title)} - ${clean(actors)}.mp4`;
            
            console.log("🚀 [Reptyle BACKGROUND DEBUG] Triggering chrome.downloads API for:", filename);

            chrome.downloads.download({
                url: url,
                filename: filename,
                conflictAction: "uniquify",
                saveAs: false 
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("🚀 [Reptyle BACKGROUND DEBUG] Download API Error: ", chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError });
                } else {
                    console.log("🚀 [Reptyle BACKGROUND DEBUG] Download started successfully with ID:", downloadId);
                    sendResponse({ success: true, downloadId: downloadId });
                }
            });
        }
    } catch (error) {
        console.error("🚀 [Reptyle BACKGROUND DEBUG] CRITICAL ERROR inside onMessage listener:", error);
        sendResponse({ success: false, error: error.toString() });
    }

    // Required to keep the message channel open for asynchronous responses
    return true; 
});

// This listener hooks into Chrome's download manager.
// EVERY time a file starts downloading, it checks if we have a custom name waiting.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    console.log("🚀 [Reptyle BACKGROUND DEBUG] Download intercept triggered! Incoming server filename:", item.filename);
    
    if (pendingFilename) {
        console.log("🚀 [Reptyle BACKGROUND DEBUG] Match found! Renaming incoming file to:", pendingFilename);
        
        // Apply our custom name to the file
        suggest({ filename: pendingFilename, conflictAction: "uniquify" });
        
        // Clear it so we don't accidentally rename a manual download you do later
        pendingFilename = ""; 
    } else {
        console.log("🚀 [Reptyle BACKGROUND DEBUG] No pending filename in memory. Letting Chrome use default name.");
        // Let Chrome use the default server name if we aren't automating a download
        suggest(); 
    }
    
    // NOTE: We do NOT return true here because we are calling suggest() synchronously.
    // In Manifest V3, returning true while calling suggest() immediately can cause Chrome to ignore the rename.
});