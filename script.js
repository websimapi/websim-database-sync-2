const { useState, useEffect, useSyncExternalStore } = React;

// WebsimSocket setup
const room = new WebsimSocket();
const ITEM_COLLECTION_TYPE = 'syncItem_v3'; // Incremented version for schema clarity

function App() {
    const [newItemContent, setNewItemContent] = useState('');
    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        let attempts = 0;
        const maxAttempts = 50; // e.g., 50 attempts * 200ms = 10 seconds
        const intervalTime = 200; // ms

        async function fetchCurrentUserWhenReady() {
            if (window.websim && typeof window.websim.getCurrentUser === 'function') {
                try {
                    const user = await window.websim.getCurrentUser();
                    setCurrentUser(user);
                } catch (error) {
                    console.error("Error fetching current user:", error);
                    // Optionally, set an error state here to inform the user
                }
            } else {
                attempts++;
                if (attempts < maxAttempts) {
                    console.warn(`window.websim.getCurrentUser not yet available. Attempt ${attempts}/${maxAttempts}. Retrying in ${intervalTime}ms...`);
                    setTimeout(fetchCurrentUserWhenReady, intervalTime);
                } else {
                    console.error(`window.websim.getCurrentUser did not become available after ${maxAttempts} attempts. Current user will not be loaded.`);
                    // Optionally, set an error state here
                }
            }
        }

        // Start the process
        fetchCurrentUserWhenReady();

    }, []); // Empty dependency array ensures this runs only once on mount
    
    const items = useSyncExternalStore(
        (callback) => room.collection(ITEM_COLLECTION_TYPE).subscribe(callback),
        () => room.collection(ITEM_COLLECTION_TYPE).getList()
    );

    useEffect(() => {
        // Process incoming data from URL query parameters on initial load
        async function processIncomingData() {
            const params = new URLSearchParams(window.location.search);
            const base64Data = params.get('data');

            if (base64Data) {
                try {
                    const jsonData = decodeURIComponent(atob(base64Data));
                    const incomingItems = JSON.parse(jsonData);

                    if (Array.isArray(incomingItems)) {
                        const currentLocalItems = room.collection(ITEM_COLLECTION_TYPE).getList();
                        const existingSyncIds = new Set(currentLocalItems.map(item => item.sync_id));
                        
                        let itemsAddedCount = 0;
                        for (const incomingItem of incomingItems) {
                            if (incomingItem && typeof incomingItem.sync_id === 'string' && typeof incomingItem.content === 'string') {
                                if (!existingSyncIds.has(incomingItem.sync_id)) {
                                    await room.collection(ITEM_COLLECTION_TYPE).create({
                                        sync_id: incomingItem.sync_id,
                                        content: incomingItem.content,
                                    });
                                    itemsAddedCount++;
                                }
                            } else {
                                console.warn("Skipping invalid incoming item:", incomingItem);
                            }
                        }
                        if (itemsAddedCount > 0) {
                             alert(`${itemsAddedCount} new item(s) synced from URL.`);
                        } else if (incomingItems.length > 0) {
                            alert("Data from URL processed. No new items to add (they likely exist already).");
                        }


                        // Clear the 'data' query parameter from URL to avoid re-processing on refresh/reload.
                        const newUrl = window.location.pathname + window.location.hash; // Keep hash if present
                        window.history.replaceState({}, document.title, newUrl);
                    }
                } catch (error) {
                    console.error("Error processing incoming data:", error);
                    alert("Failed to process sync data from URL. Check console for details.");
                }
            }
        }
        processIncomingData();
    }, []); // Empty dependency array ensures this runs only once on mount

    const handleAddItem = async () => {
        if (!newItemContent.trim()) {
            alert("Item content cannot be empty.");
            return;
        }
        const sync_id = uuid.v4(); // uuid is globally available from the CDN script
        try {
            await room.collection(ITEM_COLLECTION_TYPE).create({
                sync_id: sync_id,
                content: newItemContent.trim(),
            });
            setNewItemContent('');
        } catch (error) {
            console.error("Error adding item:", error);
            alert("Failed to add item. See console for details.");
        }
    };

    const handleSyncData = async () => {
        if (!currentUser) {
            alert("Current user not loaded yet. Please try again shortly or ensure websim.js loaded correctly.");
            return;
        }

        // Get all items, then filter locally by username for sending.
        // WebsimSocket's filter might not be immediately consistent for getList() after create.
        // So, get all, then filter.
        const allItems = room.collection(ITEM_COLLECTION_TYPE).getList();
        const userItems = allItems.filter(item => item.username === currentUser.username);

        if (userItems.length === 0) {
            alert("No items created by you to sync.");
            return;
        }

        const itemsToSync = userItems.map(item => ({
            sync_id: item.sync_id,
            content: item.content,
            // Optionally, you could include original username or timestamp if the remote system needs it
            // original_username: item.username, 
            // created_at: item.created_at 
        }));

        try {
            const jsonData = JSON.stringify(itemsToSync);
            const base64Data = btoa(encodeURIComponent(jsonData)); // URI encode before btoa for safety
            
            const syncUrl = `https://websim.com/@api/database-sync-2?data=${base64Data}`;
            
            // Navigate
            window.location.href = syncUrl;
        } catch (error) {
            console.error("Error preparing sync data:", error);
            alert("Failed to prepare data for sync. See console for details.");
        }
    };
    
    // Sort items by creation date (newest first) for display
    const displayedItems = [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return (
        <div>
            <h1>Data Sync Demo</h1>
            
            <h2>Add New Item</h2>
            <input
                type="text"
                value={newItemContent}
                onChange={(e) => setNewItemContent(e.target.value)}
                placeholder="Enter item content"
            />
            <button onClick={handleAddItem}>Add Item</button>

            <button onClick={handleSyncData} className="sync-button">
                Sync My Data to Remote
            </button>

            <h2>Local Items ({displayedItems.length})</h2>
            {displayedItems.length === 0 ? (
                <p>No items yet. Add some items or sync from a URL!</p>
            ) : (
                <ul className="item-list">
                    {displayedItems.map(item => (
                        <li key={item.id}>
                            <span className="item-content">{item.content}</span>
                            <span className="item-user">User: {item.username}</span>
                            <span className="item-sync-id">SyncID: ...{item.sync_id.slice(-6)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {currentUser ? <p>Current User: {currentUser.username}</p> : <p>Loading current user...</p>}
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);