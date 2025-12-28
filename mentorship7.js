
const firebaseConfig = {
    apiKey: "AIzaSyBFivNpSRGK87SDxzi3wWJAl3Pia_vrezo",
    authDomain: "college-mentorship--app.firebaseapp.com",
    projectId: "college-mentorship--app",
    storageBucket: "college-mentorship--app.firebasestorage.app",
    messagingSenderId: "842851012332",
    appId: "1:842851012332:web:37ff1cbf9b7b90977c1fc9",
    measurementId: "G-G6MN80S4LM"
};

let app, auth, db;

try {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    console.log("Firebase initialized");
} catch (error) { console.error(error); }
// ... (existing init code)
db = firebase.firestore();
const storage = firebase.storage(); // <--- ADD THIS
console.log("Firebase initialized");
// --- DAILY POLL LOGIC ---

// REPLACE THESE WITH REAL UIDs
const ADMIN_UIDS = [
    'user_1766072628767',  //Sid
    'user_1766080376453' //Selva
];

let currentPollData = null;

let pollUnsub; // Global variable to stop duplicate listeners
/* --- AUTO MODERATION SYSTEM --- */
const BANNED_WORDS = [
    "fuck", "bitch", "chutiya", "madarchod", "bhosdika", "bhosdike", "rand"
    , "bhadwe", "gandu", "lavda", "bhenchod", "lavdu", "chamar", "chamaar", "asshole"
];

// 2. The Filter Function
function containsSensitiveContent(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    // Check if any banned word exists in the text
    return BANNED_WORDS.some(word => lowerText.includes(word));
}

// 3. (Optional) Log the attempt to the server for Admins to see
function logModerationAttempt(text, type) {
    db.collection('moderation_logs').add({
        userId: currentUser.uid,
        userName: window.currentUserData.name,
        content: text,
        type: type, // 'post' or 'comment'
        timestamp: new Date(),
        reason: "Auto-moderated for banned words"
    });
}

function openDailyPoll() {
    lockScroll();
    const modal = document.getElementById('dailyPollModal');
    if (modal) modal.classList.add('active');

    // Check Admin Status
    const editBtn = document.getElementById('btnEditPoll');
    if (editBtn) {
        if (currentUser && typeof ADMIN_UIDS !== 'undefined' && ADMIN_UIDS.includes(currentUser.uid)) {
            editBtn.style.display = 'block';
        } else {
            editBtn.style.display = 'none';
        }
    }

    // Ensure listener is running (in case it wasn't started on login)
    if (!pollUnsub) {
        loadActivePoll();
    }
}

/* --- FIXED POLL LOADER (Prevents 'uid' of null error) --- */
/* --- FIXED POLL LOADER (Prevents 'uid' of null error) --- */
function loadActivePoll() {
    const container = document.getElementById('pollOptionsContainer');
    const questionEl = document.getElementById('pollQuestionDisplay');
    const votesEl = document.getElementById('pollTotalVotes');
    const pollBtn = document.querySelector('.daily-poll-style');

    if (container) container.innerHTML = '<p style="color:#888;">Loading...</p>';

    if (pollUnsub) pollUnsub(); // Clear old listener

    pollUnsub = db.collection('system').doc('daily_poll').onSnapshot(doc => {
        if (!doc.exists) {
            if (questionEl) questionEl.innerText = "No active poll today.";
            if (container) container.innerHTML = "";
            currentPollData = null;
            return;
        }

        const data = doc.data();
        currentPollData = data;

        // 🚨 SAFETY CHECK: If user isn't logged in yet, default to "not voted"
        // This prevents the "reading 'uid' of null" crash
        const myUid = currentUser ? currentUser.uid : null;

        // 2. CHECK VOTE STATUS
        let hasVoted = false;
        if (myUid) {
            if (data.votes && data.votes[myUid] !== undefined) hasVoted = true;
            else if (data.voters && data.voters.includes(myUid)) hasVoted = true;
        }

        if (pollBtn) {
            if (hasVoted) pollBtn.classList.add('voted');
            else pollBtn.classList.remove('voted');
        }

        // 3. RENDER CONTENT
        if (!questionEl || !container) return;

        questionEl.innerText = data.question;
        const totalVotes = data.totalVotes || 0;
        if (votesEl) votesEl.innerText = `${totalVotes} Votes`;

        let html = '';
        // Safe access to vote index
        const myVoteIndex = (myUid && data.votes) ? data.votes[myUid] : undefined;

        // Show results if voted OR if Admin
        const isAdmin = myUid && typeof ADMIN_UIDS !== 'undefined' && ADMIN_UIDS.includes(myUid);
        const showResults = hasVoted || isAdmin;

        data.options.forEach((opt, index) => {
            const voteCount = data.counts ? (data.counts[index] || 0) : 0;
            const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const isSelected = myVoteIndex === index ? 'voted' : '';

            // Disable clicking if voted OR if user is not logged in (optional UX choice)
            const clickAction = myUid ? `onclick="submitVote(${index})"` : `onclick="showToast('Please login to vote')"`;

            html += `
            <div class="poll-option-btn ${isSelected}" ${clickAction} style="${hasVoted ? 'pointer-events:none;' : ''}">
                <div class="poll-fill-bar" style="width: ${showResults ? percent : 0}%"></div>
                <div class="poll-text-wrapper">
                    <span>${opt}</span>
                    ${showResults ? `<span>${percent}%</span>` : ''}
                </div>
            </div>`;
        });

        container.innerHTML = html;
    });
}

function submitVote(optionIndex) {
    triggerHaptic();
    if (!currentUser) return showToast("Please login to vote.");

    // 1. SAFETY CHECK: Ensure poll data exists
    if (!currentPollData) {
        console.error("Poll data not loaded yet.");
        return showToast("Poll is loading, please wait...");
    }

    // 2. SAFETY CHECK: Ensure 'votes' object exists (Initialize if missing)
    const votesMap = currentPollData.votes || {};

    // 3. Optimistic check using safe variable
    if (votesMap[currentUser.uid] !== undefined) {
        return showToast("You already voted today!");
    }

    const pollRef = db.collection('system').doc('daily_poll');

    db.runTransaction(async (t) => {
        const doc = await t.get(pollRef);
        if (!doc.exists) throw "Poll does not exist";

        const data = doc.data();
        const safeVotes = data.votes || {}; // Double safety inside transaction

        if (safeVotes[currentUser.uid] !== undefined) {
            throw "Already voted";
        }

        const newCounts = data.counts || new Array(data.options.length).fill(0);
        newCounts[optionIndex] = (newCounts[optionIndex] || 0) + 1;

        t.update(pollRef, {
            [`votes.${currentUser.uid}`]: optionIndex,
            counts: newCounts,
            totalVotes: firebase.firestore.FieldValue.increment(1)
        });
    }).then(() => {
        showToast("Vote cast!");
    }).catch(e => {
        if (e === "Already voted") showToast("You already voted.");
        else {
            console.error(e);
            showToast("Error processing vote.");
        }
    });
}
// --- ADMIN ONLY FUNCTIONS ---

// --- ADMIN ONLY FUNCTIONS ---

function togglePollEditMode() {
    const view = document.getElementById('pollViewMode');
    const edit = document.getElementById('pollEditMode');
    const optionsList = document.getElementById('pollOptionsList');

    if (view.classList.contains('hidden')) {
        // Switching BACK to View Mode
        view.classList.remove('hidden');
        edit.classList.add('hidden');
    } else {
        // Switching TO Edit Mode
        view.classList.add('hidden');
        edit.classList.remove('hidden');

        // Clear and Initialize with 2 empty options if empty
        if (optionsList.innerHTML.trim() === '') {
            addPollOptionField('', false); // Option 1 (No remove button)
            addPollOptionField('', false); // Option 2 (No remove button)
        }
    }
}

function addPollOptionField(value = '', allowRemove = true) {
    const container = document.getElementById('pollOptionsList');
    const div = document.createElement('div');
    div.className = 'poll-input-row';

    // Generate unique ID for input
    const id = 'pollOpt_' + Date.now() + Math.random().toString(36).substr(2, 5);

    div.innerHTML = `
                <input type="text" id="${id}" value="${value}" placeholder="Enter option..." class="poll-option-input">
                ${allowRemove ? `<div class="btn-remove-opt" onclick="this.parentElement.remove()">✕</div>` : ''}
            `;

    container.appendChild(div);
}

function saveNewPoll() {
    const q = document.getElementById('newPollQuestion').value.trim();

    // Collect all inputs from the dynamic list
    const inputs = document.querySelectorAll('.poll-option-input');
    const options = [];

    inputs.forEach(input => {
        const val = input.value.trim();
        if (val) options.push(val);
    });

    if (!q) return alert("Please enter a question.");
    if (options.length < 2) return alert("Please provide at least 2 valid options.");

    if (!confirm("This will WIPE the current poll and start fresh. Confirm?")) return;

    // Initialize counts array based on number of options
    const zeroCounts = new Array(options.length).fill(0);

    db.collection('system').doc('daily_poll').set({
        question: q,
        options: options,
        counts: zeroCounts,
        votes: {}, // Reset votes map
        totalVotes: 0,
        createdAt: new Date()
    }).then(() => {
        showToast("New Daily Poll Published!");

        // Reset UI
        document.getElementById('newPollQuestion').value = "";
        document.getElementById('pollOptionsList').innerHTML = ""; // Clear options

        togglePollEditMode(); // Go back to view mode
    }).catch(e => {
        console.error(e);
        alert("Error saving poll: " + e.message);
    });
}

// --- GLOBAL STATE ---
let currentUser = null; // FIXED: Removed "letlet" typo
let currentUserData = null;

// --- CONSTANTS (Moved to Top) ---
const TAG_DATA = [
    { name: "Technical", class: "tag-technical", hex: "#0079D3" },
    { name: "Academic", class: "tag-academic", hex: "#FF4500" },
    { name: "Council / Committee", class: "tag-council", hex: "#46D160", hasSub: true },
    { name: "Faculty Related", class: "tag-faculty", hex: "#D93A00" },
    { name: "Career Advice", class: "tag-career", hex: "#7193FF" },
    { name: "Placements / Internships", class: "tag-placements", hex: "#FFB000" },
    { name: "Campus / Infrastructure", class: "tag-campus", hex: "#0DD3BB" },
    { name: "Sports", class: "tag-sports", hex: "#CC3600" },
    { name: "Honest Review", class: "tag-review", hex: "#FF585B" },
    { name: "General", class: "tag-general", hex: "#878A8C" },
    { name: "Gossip", class: "tag-gossip", hex: "#A335EE" }
];

const COUNCIL_SUBS = [
    "Technical Council", "Cultural Council", "Sports Council",
    "CESA", "CSI", "GDG", "NSS", "IEEE", "V-Club", "Music Club"
];

// --- FILTERS ---
window.activeFilters = {
    sortBy: 'latest',
    years: [],
    tags: []
};

// --- STARTUP ---
document.getElementById('authScreen').classList.remove('hidden');
document.getElementById('appScreen').classList.add('hidden');

loadDevUsers(); // Load users immediately

// 2. Force Show Login Screen, Hide App
document.getElementById('authScreen').classList.remove('hidden');
document.getElementById('appScreen').classList.add('hidden');

// --- AUTH LOGIC ---
// --- AUTH: REAL LOGIN HANDLER ---
// --- AUTH: REAL LOGIN HANDLER (FIXED) ---
// --- LIGHTBOX LOGIC (Zoom & Pan) ---
let currentScale = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;

function openLightbox(src) {
    const modal = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImg');

    // Reset state
    currentScale = 1;
    translateX = 0;
    translateY = 0;
    img.style.transform = `translate(0px, 0px) scale(1)`;

    img.src = src;
    modal.style.display = "flex";

    // Add Scroll Listener
    img.addEventListener('wheel', handleZoom, { passive: false });
    // Add Drag Listeners
    img.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', drag);
    window.addEventListener('mouseup', endDrag);
}
// --- UPLOAD HELPER ---
function uploadFileToStorage(file) {
    return new Promise((resolve, reject) => {
        // Create a unique file name
        const fileName = Date.now() + "_" + file.name;
        const storageRef = storage.ref().child('uploads/' + fileName);

        // --- NEW: FORCE DOWNLOAD METADATA ---
        const metadata = {
            contentType: file.type,
            contentDisposition: `attachment; filename="${file.name}"`
        };

        const uploadTask = storageRef.put(file, metadata); // <--- Pass metadata here

        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                console.log('Upload is ' + progress + '% done');
            },
            (error) => {
                console.error("Upload failed:", error);
                reject(error);
            },
            () => {
                uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
                    resolve(downloadURL);
                });
            }
        );
    });
}
// --- YEAR BADGE HELPER ---
function getYearBadgeHtml(year) {
    if (!year || year === 'undefined') return '';

    let color = '#888'; // Default Gray
    // Twitter/Apple System Colors
    if (year === 'FE') color = '#30D158'; // Green
    if (year === 'SE') color = '#0A84FF'; // Blue
    if (year === 'TE') color = '#BF5AF2'; // Purple
    if (year === 'BE') color = '#FF9F0A'; // Orange

    return `<span style="
        color: ${color}; 
        border: 1px solid ${color}; 
        background: ${color}15; 
        padding: 1px 5px; 
        border-radius: 4px; 
        font-size: 9px; 
        font-weight: 800; 
        margin-left: 6px; 
        vertical-align: middle;
        display: inline-block;
    ">${year}</span>`;
}
function closeLightbox() {
    const modal = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImg');
    modal.style.display = "none";

    // Clean up listeners
    img.removeEventListener('wheel', handleZoom);
    img.removeEventListener('mousedown', startDrag);
    window.removeEventListener('mousemove', drag);
    window.removeEventListener('mouseup', endDrag);
}
// --- CUSTOM CONFIRMATION LOGIC ---
function showConfirm(title, message, onConfirmCallback) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;

    // Assign the specific action to the Confirm button
    const confirmBtn = document.getElementById('btnConfirmAction');
    confirmBtn.onclick = function () {
        onConfirmCallback(); // Run the passed function
        closeConfirmModal(); // Close modal
    };

    modal.classList.add('active');
}
function showToast(message) {
    const x = document.getElementById("customToast");
    x.innerText = message;
    x.className = "show";
    setTimeout(function () { x.className = x.className.replace("show", ""); }, 3000);
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

function handleZoom(event) {
    event.preventDefault(); // Stop page scrolling
    const img = document.getElementById('lightboxImg');

    // Determine zoom direction
    const delta = event.deltaY * -0.005; // -0.005 sensitivity
    const newScale = Math.min(Math.max(0.5, currentScale + delta), 5); // Min 0.5x, Max 5x

    currentScale = newScale;
    updateTransform();
}
function deleteMessage(chatId, messageId) {
    if (!confirm("Unsend this message?")) return;

    db.collection('chats').doc(chatId).collection('messages').doc(messageId).delete()
        .then(() => {
            console.log("Message unsent");
            // The onSnapshot listener in openInlineChat will automatically remove it from the UI
        })
        .catch(error => {
            console.error("Error removing message: ", error);
            alert("Could not unsend message.");
        });
}
// --- DRAG / PAN LOGIC ---
function startDrag(e) {
    if (currentScale <= 1) return; // Only drag if zoomed in
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    document.getElementById('lightboxImg').style.cursor = 'grabbing';
}

function drag(e) {
    if (!isDragging) return;
    e.preventDefault();
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateTransform();
}

function endDrag() {
    isDragging = false;
    document.getElementById('lightboxImg').style.cursor = 'grab';
}

function updateTransform() {
    const img = document.getElementById('lightboxImg');
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentScale})`;
}
function handleLogin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value.trim();
    const isAnon = document.getElementById('loginAnon').checked;

    if (!email || !password) return showToast("Please enter credentials.");

    btn.innerText = "Verifying...";
    btn.disabled = true;

    // Check DB
    db.collection('users').where('email', '==', email).get()
        .then(snap => {
            if (!snap.empty) {
                const userDoc = snap.docs[0];
                const userData = userDoc.data();

                // --- PASSWORD CHECK ---
                if (userData.password === password) {
                    // Success!
                    simulateLogin(userDoc.id, isAnon);
                } else {
                    // Fail!
                    showToast("❌ Incorrect Password");
                    btn.innerText = originalText;
                    btn.disabled = false;
                }
            } else {
                showToast("❌ Account not found.");
                btn.innerText = originalText;
                btn.disabled = false;
            }
        })
        .catch(err => {
            console.error(err);
            showToast("Login Error.");
            btn.innerText = originalText;
            btn.disabled = false;
        });
}
// --- HELPER: GENERATE BUTTON HTML ---
function generateUserButtonHtml(u) {
    const uid = u.userId || u.uid; // Handle both structures
    const name = (u.name || "Unknown").charAt(0).toUpperCase() + (u.name || "User").slice(1);

    // Visual Logic
    let icon, statusColor, statusText;
    if (u.role === 'mentor') {
        if (u.isVerified) {
            icon = '✔'; statusColor = 'var(--success-color)'; statusText = 'VERIFIED MENTOR';
        } else {
            icon = '⚠️'; statusColor = 'var(--danger-color)'; statusText = 'UNVERIFIED MENTOR';
        }
    } else {
        icon = '🎓'; statusColor = 'var(--text-muted)'; statusText = 'STUDENT';
    }

    const borderColor = u.role === 'mentor' && u.isVerified ? 'var(--success-color)' : 'var(--glass-border)';

    return `
            <button class="btn btn-secondary" onclick="simulateLogin('${uid}')" style="justify-content: flex-start; gap: 12px; border: 1px solid ${borderColor}; padding: 12px; margin-bottom:10px; width:100%; transition: transform 0.2s;">
                <div style="width:30px; height:30px; border-radius:50%; background:${statusColor}; color:black; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:14px; flex-shrink:0;">
                    ${u.profilePic ? `<img src="${u.profilePic}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : icon}
                </div>
                <div style="text-align:left; overflow:hidden;">
                    <div style="font-weight: 700; color: white; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                    <div style="font-size: 10px; color: ${statusColor}; font-weight:600;">${statusText}</div>
                </div>
            </button>`;
}
// --- INIT APP ---
// 1. Reset
currentUser = null;
currentUserData = null;

// 2. Show Login
document.getElementById('authScreen').classList.remove('hidden');
document.getElementById('appScreen').classList.add('hidden');



// --- 2. UPDATE LOGIN TO START TRACKING ---
function simulateLogin(uid, isAnonSession) {
    db.collection('users').doc(uid).get().then(doc => {
        const realData = doc.data();

        // 1. Create Session Data
        if (isAnonSession) {
            window.currentUserData = {
                ...realData,
                // MASKED DATA FOR FRONTEND LOGIC
                displayNameOverride: "Anonymous",
                roleOverride: "Guest",
                profilePicOverride: "",
                isAnonymousSession: true,
                realYear: realData.year // Keep real year accessible for logic but not display
            };
        } else {
            window.currentUserData = { ...realData, isAnonymousSession: false };
        }
        window.currentUser = { uid: doc.id };
        currentUser = window.currentUser;
        currentUserData = window.currentUserData;

        // 2. UI Switch
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');

        // 3. UI Restrictions for Anonymous
        if (isAnonSession) {
            // HIDE TABS
            const tabs = document.querySelectorAll('.tab-button');
            tabs.forEach(t => {
                if (t.innerText === "Messages" || t.innerText === "Explore") {
                    t.style.display = 'none';
                }
            });

            // HIDE NAVBAR ICONS
            const navRight = document.querySelector('.navbar-right');
            // Hide connection/request icons (first 2 children)
            navRight.children[0].children[0].classList.add('hidden');
            navRight.children[0].children[1].classList.add('hidden');

            updateUserInfo();
            switchTab('community');
        } else {
            // RESTORE UI (In case of re-login)
            document.querySelectorAll('.tab-button').forEach(t => t.style.display = 'block');
            const navRight = document.querySelector('.navbar-right');
            navRight.children[0].children[0].classList.remove('hidden');
            navRight.children[0].children[1].classList.remove('hidden');

            loadActivePoll();
            initMessageBadgeListener();
            updateUserInfo();
            loadDevUsers();
            initNotificationListener();
            startPresenceHeartbeat();
            switchTab('community');
        }
    });
}
// --- AUTH: TOGGLE UI ---
function toggleAuthMode(mode) {
    if (mode === 'register') {
        document.getElementById('loginSection').classList.add('hidden');
        document.getElementById('registerSection').classList.remove('hidden');
    } else {
        document.getElementById('registerSection').classList.add('hidden');
        document.getElementById('loginSection').classList.remove('hidden');
    }
}

function applyCardTheme(img) {
    // 1. Safety check
    if (!img.complete || img.naturalWidth === 0) return;

    try {
        // 2. Get Dominant Color
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const rgb = `${r},${g},${b}`;

        // 3. Find the parent Card
        const card = img.closest('.card');
        if (card) {
            // 🚨 FIX: Apply SOLID color (with slight gradient for depth), NO image texture
            card.style.background = `linear-gradient(135deg, rgb(${rgb}), rgba(${rgb}, 0.8))`;

            // Match border and shadow to the theme
            card.style.borderColor = `rgba(${rgb}, 0.6)`;
            card.style.boxShadow = `0 15px 40px -10px rgba(${rgb}, 0.4)`;

            // 4. Calculate Contrast (YIQ Formula)
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            const isDarkBg = yiq < 128; // < 128 means the background is dark

            // 5. Apply Text Colors based on contrast
            const titleColor = isDarkBg ? '#ffffff' : '#000000';
            const bodyColor = isDarkBg ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)';

            // Apply colors to text elements
            card.querySelectorAll('.card-header, strong').forEach(el => el.style.color = titleColor);
            card.querySelectorAll('p, small').forEach(el => el.style.color = bodyColor);

            // Fix badges to match new contrast
            card.querySelectorAll('.badge').forEach(el => {
                el.style.color = titleColor;
                el.style.borderColor = bodyColor;
                el.style.background = isDarkBg ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)';
            });
        }
    } catch (e) {
        console.log("Could not extract color:", e);
    }
}

// --- AUTH: WORK EXPERIENCE LOGIC ---
function addExperienceField() {
    const container = document.getElementById('workExpContainer');
    const div = document.createElement('div');
    div.className = 'exp-row';
    div.innerHTML = `
                <input type="text" class="exp-input" placeholder="e.g. Intern at Google" style="flex-grow:1;">
                <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" style="padding: 0 12px;">X</button>
            `;
    container.appendChild(div);
}

// --- AUTH: REGISTER HANDLER ---
// --- AUTH: REGISTER HANDLER (FIXED) ---
// --- AUTH: REGISTER HANDLER (FIXED) ---
function handleLogin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value.trim();
    // CAPTURE CHECKBOX STATE
    const isAnon = document.getElementById('loginAnon').checked;

    if (!email || !password) return showToast("Please enter credentials.");

    btn.innerText = "Verifying...";
    btn.disabled = true;

    // Check DB
    db.collection('users').where('email', '==', email).get()
        .then(snap => {
            if (!snap.empty) {
                const userDoc = snap.docs[0];
                // In a real app, verify password here. For demo, we trust it.
                simulateLogin(userDoc.id, isAnon);
            } else {
                showToast("Account not found.");
                btn.innerText = originalText;
                btn.disabled = false;
            }
        })
        .catch(err => {
            console.error(err);
            btn.innerText = originalText;
            btn.disabled = false;
        });
}

function handleRegister(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;

    submitBtn.disabled = true;
    submitBtn.innerText = "Creating Account...";

    // 1. Get Values
    const isAnon = document.getElementById('regAnon').checked;
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const password = document.getElementById('regPass').value;
    const age = document.getElementById('regAge').value;
    const gender = document.getElementById('regGender').value;
    const year = document.getElementById('regYear').value;
    const college = document.getElementById('regCollege').value;

    // --- NEW: CAPTURE SELECTED ROLE ---
    const role = document.getElementById('regRole').value;
    // ----------------------------------

    if (!password || password.length < 6) {
        alert("Password must be at least 6 characters.");
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
        return;
    }

    const performRegistration = (base64Pic) => {
        const newUserId = "user_" + Date.now();

        // Collect Work Experience (if any)
        const workExpInputs = document.querySelectorAll('.exp-input');
        const expertise = [];
        workExpInputs.forEach(input => {
            if (input.value.trim()) expertise.push(input.value.trim());
        });

        const newUser = {
            userId: newUserId,
            name: name,
            email: email,
            role: role, // <--- SAVES 'student' OR 'mentor'
            year: year,
            college: college,
            age: age,
            gender: gender,
            profilePic: base64Pic || "",
            expertise: expertise, // Save work experience
            isVerified: false,
            score: 0, // Initialize score
            createdAt: new Date(),
            password: password
        };

        // 2. Save to Firestore
        db.collection('users').doc(newUserId).set(newUser)
            .then(() => {
                if (typeof showToast === 'function') showToast("Account created!");
                // 3. Log them in immediately
                simulateLogin(newUserId, isAnon);
            })
            .catch(err => {
                console.error(err);
                alert("Error: " + err.message);
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            });
    };

    // 4. Handle File Upload
    const fileInput = document.getElementById('regFile');
    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = function (e) { performRegistration(e.target.result); };
        reader.readAsDataURL(fileInput.files[0]);
    } else {
        performRegistration(null);
    }
}
/* --- TOGGLE PASSWORD VISIBILITY --- */
function togglePasswordVisibility(inputId, iconDiv) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === "password") {
        // Show Password
        input.type = "text";
        // Change icon to "Eye Slash" (Hidden)
        iconDiv.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>`;
    } else {
        // Hide Password
        input.type = "password";
        // Change icon back to "Eye" (Visible)
        iconDiv.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>`;
    }
}
// --- NOTIFICATION LOGIC ---
let currentPendingRequestIds = [];

function initNotificationListener() {
    if (!currentUser) return;

    db.collection('connection_requests')
        .where('recipientId', '==', currentUser.uid)
        .where('status', '==', 'pending')
        .onSnapshot(snap => {
            // 1. Get all current pending IDs from DB
            currentPendingRequestIds = snap.docs.map(doc => doc.id);

            // 2. Get list of IDs we have already "seen" (from LocalStorage)
            const viewedIds = JSON.parse(localStorage.getItem('viewedRequests') || '[]');

            // 3. Count how many pending IDs are NOT in the viewed list
            const newCount = currentPendingRequestIds.filter(id => !viewedIds.includes(id)).length;

            // 4. Update UI
            const badge = document.getElementById('requestBadge');
            if (newCount > 0) {
                badge.innerText = newCount > 9 ? '9+' : newCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        });
}
// --- DEV: LOAD ALL USERS ---
// --- DEV: LOAD ALL USERS (Fixed) ---
function loadDevUsers() {
    const container = document.getElementById('devUserList');
    container.innerHTML = '<p style="color:#666; font-size:13px;">Loading accounts...</p>';

    // Only fetch real users from Firestore
    db.collection('users').orderBy('createdAt', 'desc').get().then(snap => {
        container.innerHTML = ''; // Clear loading text

        if (snap.empty) {
            container.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No accounts found.</p>';
            return;
        }

        snap.forEach(doc => {
            const u = doc.data();
            u.userId = doc.id;
            container.innerHTML += generateUserButtonHtml(u);
        });
    }).catch(e => {
        console.error("Dev list error:", e);
        container.innerHTML = '<p style="color:var(--danger-color);">Error loading users.</p>';
    });
}


async function deleteAccount() {
    if (!confirm("⚠️ FINAL WARNING: This will delete your account, posts, chats, and connections. This cannot be undone.")) return;

    const user = auth.currentUser;
    const userId = user.uid;

    try {
        // 1. Delete My Posts
        const postsSnap = await db.collection('posts').where('authorId', '==', userId).get();
        const batch1 = db.batch();
        postsSnap.forEach(doc => batch1.delete(doc.ref));
        await batch1.commit();
        console.log("User posts deleted");

        // 2. Delete My Chats (and the messages inside)
        // Note: In a real app we'd delete subcollections recursively, but here we delete the chat doc handle
        const chatsSnap = await db.collection('chats').where('participants', 'array-contains', userId).get();
        const batch2 = db.batch();
        chatsSnap.forEach(doc => batch2.delete(doc.ref));
        await batch2.commit();
        console.log("User chats deleted");

        // 3. Delete Connection Requests (Sent & Received)
        const sentSnap = await db.collection('connection_requests').where('senderId', '==', userId).get();
        const recSnap = await db.collection('connection_requests').where('recipientId', '==', userId).get();
        const batch3 = db.batch();
        sentSnap.forEach(doc => batch3.delete(doc.ref));
        recSnap.forEach(doc => batch3.delete(doc.ref));
        await batch3.commit();
        console.log("Connections deleted");

        // 4. Delete User Profile
        await db.collection('users').doc(userId).delete();

        // 5. Delete Auth Credential
        await user.delete();

        alert("Account and all associated data deleted.");
        sessionStorage.clear();
        window.location.reload();

    } catch (error) {
        console.error("Error deleting account:", error);
        if (error.code === 'auth/requires-recent-login') {
            alert("Security Check: Please log out and log back in, then try deleting your account again.");
        } else {
            alert("Failed to delete account: " + error.message);
        }
    }
}


// --- NAVIGATION LOGIC (FIXED) ---
function switchTab(arg1, arg2) {
    let tabName = typeof arg1 === 'string' ? arg1 : arg2;

    // --- NEW LOGIC: Clear Badge when opening Requests ---
    if (tabName === 'requests') {
        // Save all current pending IDs as "viewed"
        localStorage.setItem('viewedRequests', JSON.stringify(currentPendingRequestIds));
        // Hide badge immediately
        document.getElementById('requestBadge').classList.add('hidden');
    }
    if (document.getElementById('chats')) {
        document.getElementById('chats').classList.remove('mobile-chat-open');
    }

    // ... (Keep your existing tab switching logic below) ...
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');

    const btn = document.querySelector(`.tab-button[onclick*="'${tabName}'"]`);
    if (btn) btn.classList.add('active');

    if (tabName === 'mentors') loadMentors();
    if (tabName === 'chats') loadChats();
    if (tabName === 'community') loadCommunity();
    if (tabName === 'requests') loadRequests();
    if (tabName === 'profile') loadProfile();
    if (tabName === 'leaderboard') loadLeaderboard();
    if (tabName === 'events') loadEvents();
}

// --- CONTEXT MENU LOGIC (Dynamic) ---
let contextMenuTarget = { type: null, id1: null, id2: null };
let longPressTimer;

function showContextMenu(e, type, id1, id2 = null) {
    e.preventDefault();
    e.stopPropagation(); // Prevent other clicks

    contextMenuTarget = { type, id1, id2 };

    const menu = document.getElementById('customContextMenu');
    const btnUnsend = document.getElementById('btnUnsend');
    const btnDelete = document.getElementById('btnDeleteChat');

    // 1. Toggle Buttons based on Type
    if (type === 'message') {
        btnUnsend.style.display = 'block';
        btnDelete.style.display = 'none';
    } else if (type === 'chat') {
        btnUnsend.style.display = 'none';
        btnDelete.style.display = 'block';
    }

    // 2. Position Menu
    let x = e.pageX || (e.touches ? e.touches[0].pageX : 0);
    let y = e.pageY || (e.touches ? e.touches[0].pageY : 0);

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
}

function hideContextMenu() {
    document.getElementById('customContextMenu').style.display = 'none';
}
window.addEventListener('click', hideContextMenu);
window.addEventListener('scroll', hideContextMenu);

// --- ACTIONS ---
function performUnsend() {
    // id1 = chatId, id2 = msgId
    if (contextMenuTarget.type === 'message') {
        deleteMessage(contextMenuTarget.id1, contextMenuTarget.id2);
    }
    hideContextMenu();
}
/* --- BOOKMARK SYSTEM --- */

// 1. Toggle Bookmark (Save/Unsave)
function toggleBookmark(event, postId) {
    triggerHaptic();
    event.stopPropagation(); // Prevent opening post details

    if (!currentUser) return showToast("Login to save posts.");

    const btn = event.currentTarget;
    const isActive = btn.classList.contains('bookmarked');
    const icon = btn.querySelector('svg');

    // Optimistic UI Update (Instant Feedback)
    if (isActive) {
        btn.classList.remove('bookmarked');
        btn.style.color = "var(--text-secondary)";
        icon.style.fill = "none";
        icon.style.stroke = "currentColor";

        // DB Update
        db.collection('users').doc(currentUser.uid).update({
            bookmarks: firebase.firestore.FieldValue.arrayRemove(postId)
        }).catch(e => console.error(e));

        // Local State Update
        if (window.currentUserData.bookmarks) {
            window.currentUserData.bookmarks = window.currentUserData.bookmarks.filter(id => id !== postId);
        }

    } else {
        btn.classList.add('bookmarked');
        btn.style.color = "#FFD700"; // Gold color
        icon.style.fill = "#FFD700";
        icon.style.stroke = "#FFD700";

        // DB Update
        db.collection('users').doc(currentUser.uid).update({
            bookmarks: firebase.firestore.FieldValue.arrayUnion(postId)
        }).then(() => showToast("Post Saved to Profile"))
            .catch(e => console.error(e));

        // Local State Update
        if (!window.currentUserData.bookmarks) window.currentUserData.bookmarks = [];
        window.currentUserData.bookmarks.push(postId);
    }
}

// 2. Open Saved Posts Modal
async function openSavedPosts() {
    lockScroll();
    const modal = document.getElementById('savedPostsModal');
    const listEl = document.getElementById('savedPostsList');

    modal.classList.add('active');
    listEl.innerHTML = '<p style="text-align:center; margin-top:20px; color:#888;">Loading saved items...</p>';

    const bookmarks = window.currentUserData.bookmarks || [];

    if (bookmarks.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state-new" style="margin-top:20px;">
                <div style="font-size:30px; margin-bottom:10px;">🔖</div>
                You haven't saved any posts yet.
            </div>`;
        return;
    }

    try {
        // Fetch all bookmarked posts
        // Note: Firestore doesn't support "where id IN huge_array" well, so we fetch by doc ID in parallel
        const promises = bookmarks.map(id => db.collection('posts').doc(id).get());
        const snapshots = await Promise.all(promises);

        const posts = snapshots
            .filter(doc => doc.exists) // Remove deleted posts
            .map(doc => ({ ...doc.data(), id: doc.id }));

        if (posts.length === 0) {
            listEl.innerHTML = '<p style="text-align:center; margin-top:20px; color:#888;">Saved posts may have been deleted by authors.</p>';
            return;
        }

        // Reuse your existing logic to render posts (Simplified for this view)
        // We'll create a simple render loop here to avoid complexity
        const html = posts.map(p => {
            const timeString = timeAgo(p.createdAt);
            return `
    <div class="card" onclick="viewPost('${p.id}')" style="cursor:pointer; border:1px solid var(--border-color); padding:15px; margin-bottom:15px; transition: opacity 0.3s;">
        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:5px;">
            Saved • Posted by ${p.authorName} • ${timeString}
        </div>
        <div style="font-weight:700; font-size:16px; margin-bottom:5px;">${p.title}</div>
        <div style="font-size:14px; color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${p.body}
        </div>
        <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button class="btn btn-sm btn-secondary" 
                    onclick="removeFromSaved(event, '${p.id}')"
                    style="border: 1px solid var(--danger-color); color: var(--danger-color); background: rgba(255, 69, 58, 0.1);">
                Remove
            </button>
        </div>
    </div>`;
        }).join('');

        listEl.innerHTML = html;

    } catch (e) {
        console.error(e);
        listEl.innerHTML = '<p style="color:red; text-align:center;">Error loading bookmarks.</p>';
    }
}

function performDeleteChat() {
    if (contextMenuTarget.type === 'chat') {
        showConfirm(
            "Delete Conversation?",
            "This will delete the chat history permanently.",
            () => {
                db.collection('chats').doc(contextMenuTarget.id1).delete().then(() => {
                    loadChats();
                    // Clear screen if open
                    if (document.getElementById('selectedChatId').value === contextMenuTarget.id1) {
                        document.getElementById('chatHeader').textContent = "Select a chat to begin.";
                        document.getElementById('messagesContainer').innerHTML = "";
                        document.getElementById('sendMessageForm').classList.add('hidden');
                    }
                });
            }
        );
    }
    hideContextMenu();
}
/* --- REPORT ACTIONS --- */

// Option 1: Hide (Remove from view completely)
function hidePostLocally(postId) {
    const card = document.getElementById(`post-card-${postId}`);
    if (card) {
        card.style.transition = "opacity 0.3s, transform 0.3s";
        card.style.opacity = "0";
        card.style.transform = "scale(0.9)";
        setTimeout(() => card.remove(), 300); // Remove from DOM
    }
}

// Option 2: Dismiss (Show content temporarily)
function dismissReportWall(postId) {
    const wall = document.getElementById(`wall-${postId}`);
    const content = document.getElementById(`content-${postId}`);

    if (wall && content) {
        wall.style.display = 'none'; // Hide wall
        content.classList.remove('content-hidden'); // Show content
    }
}

// --- LONG PRESS HANDLERS ---
function startLongPress(e, type, id1, id2 = null) {
    longPressTimer = setTimeout(() => {
        showContextMenu(e, type, id1, id2);
    }, 600);
}

function cancelLongPress() {
    clearTimeout(longPressTimer);
}
// --- POST OPTIONS LOGIC ---
function togglePostMenu(event, postId) {
    event.stopPropagation(); // Prevent opening post detail

    // Close all other open menus first
    document.querySelectorAll('.options-menu').forEach(el => {
        if (el.id !== `menu-${postId}`) el.classList.remove('active');
    });

    const menu = document.getElementById(`menu-${postId}`);
    if (menu) menu.classList.toggle('active');
}

// Close menus when clicking anywhere else
window.addEventListener('click', () => {
    document.querySelectorAll('.options-menu').forEach(el => el.classList.remove('active'));
});

function reportPost(event, postId) {
    event.stopPropagation();

    const menu = document.getElementById(`menu-${postId}`);
    if (menu) menu.classList.remove('active');

    if (!currentUser) {
        showToast("Please login to report.");
        return;
    }

    // Check existing reports first
    db.collection('posts').doc(postId).get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        const reports = data.reports || [];

        if (reports.includes(currentUser.uid)) {
            showToast("⚠️ You already reported this.");
            return;
        }

        showConfirm(
            "Report Post?",
            "Are you sure you want to flag this content? It will be hidden from your feed.",
            () => {
                db.collection('posts').doc(postId).update({
                    reports: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
                    reportCount: firebase.firestore.FieldValue.increment(1)
                }).then(() => {
                    showToast("Report submitted.");
                    // RELOAD FEED TO SHOW WALL IMMEDIATELY
                    loadCommunity();
                }).catch(e => {
                    console.error(e);
                    showToast("Error reporting.");
                });
            }
        );
    });
}

// --- POST FILE HANDLING ---
function handlePostFileSelect() {
    const fileInput = document.getElementById('postFileInput');
    const nameDisplay = document.getElementById('postFileName');
    const removeBtn = document.getElementById('removePostImgBtn');
    if (fileInput.files.length > 0) {
        nameDisplay.innerText = fileInput.files[0].name;
        removeBtn.style.display = 'inline-block';
    }
}

function removePostImage() {
    const fileInput = document.getElementById('postFileInput');
    const nameDisplay = document.getElementById('postFileName');
    const removeBtn = document.getElementById('removePostImgBtn');
    fileInput.value = "";
    nameDisplay.innerText = "No file";
    removeBtn.style.display = 'none';
}

function handleChatFileSelect(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const chatId = document.getElementById('selectedChatId').value;

        // 1. Detect Type
        let type = 'image';
        if (file.type.startsWith('video/')) type = 'video';
        else if (file.type.includes('pdf') || file.type.includes('document') || file.name.match(/\.(doc|docx|ppt|pptx|txt)$/i)) type = 'document';

        // 2. Limit Size (20MB)
        if (file.size > 20 * 1024 * 1024) {
            alert("File too large. Max 20MB allowed.");
            input.value = "";
            return;
        }

        if (typeof showToast === 'function') showToast("Uploading file...");

        uploadFileToStorage(file).then(url => {
            // 3. Send Message with Metadata
            db.collection('chats').doc(chatId).collection('messages').add({
                imageUrl: url, // Reuse this field for file URL
                mediaType: type,
                fileName: file.name, // Save name
                fileSize: file.size, // Save size
                text: type === 'document' ? "Sent a file" : (type === 'video' ? "Sent a video" : "Sent an image"),
                senderId: currentUser.uid,
                timestamp: new Date()
            });

            // Update Metadata
            let lastMsgText = "📷 Image";
            if (type === 'video') lastMsgText = "🎥 Video";
            if (type === 'document') lastMsgText = "📄 File";

            db.collection('chats').doc(chatId).update({
                lastMessage: lastMsgText,
                updatedAt: new Date(),
                lastSenderId: currentUser.uid
            });

        }).catch(err => alert("Upload failed: " + err.message));

        input.value = "";
    }
}


function sendChatFile(base64String, type) {
    // ... existing code ...

    db.collection('chats').doc(chatId).collection('messages').add({
        imageUrl: base64String,
        mediaType: type,
        text: type === 'video' ? "Sent a video" : "Sent an image",
        senderId: currentUser.uid,
        timestamp: new Date()
    });

    // Update Chat Metadata (ADD lastSenderId)
    db.collection('chats').doc(chatId).update({
        lastMessage: type === 'video' ? "🎥 Video" : "📷 Image",
        updatedAt: new Date(),
        lastSenderId: currentUser.uid // <--- ADD THIS LINE
    });
}

function sendChatImage(base64String) {
    const chatId = document.getElementById('selectedChatId').value;
    if (!chatId) return;

    // Send message with imageUrl field
    db.collection('chats').doc(chatId).collection('messages').add({
        imageUrl: base64String,
        text: "Sent an image", // Fallback text for list view
        senderId: currentUser.uid,
        timestamp: new Date()
    });

    // Update last message in chat list
    db.collection('chats').doc(chatId).update({
        lastMessage: "📷 Image",
        updatedAt: new Date()
    });
}
// --- EMOJI LOGIC ---
const commonEmojis = [
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "😊",
    "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙",
    "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎",
    "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😕", "🙁",
    "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠",
    "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "🤗", "🤔",
    "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦",
    "👍", "👎", "👊", "✊", "🤛", "🤜", "🤞", "✌️", "🤟", "🤘",
    "👌", "🤌", "🤏", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚",
    "👋", "🔥", "✨", "❤️", "💯", "🎉", "💀", "💩", "🤡", "👻"
];

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    picker.classList.toggle('hidden');

    // Lazy load emojis only when opened first time
    if (picker.innerHTML === "") {
        commonEmojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = "emoji-btn";
            btn.innerText = emoji;
            btn.type = "button"; // Prevent form submission
            btn.onclick = () => insertEmoji(emoji);
            picker.appendChild(btn);
        });
    }
}
// --- ADMIN PANEL LOGIC ---

async function openAdminPanel() {
    // 1. PIN Security Check (First Layer)
    const pin = prompt("Enter Admin PIN:");
    if (pin !== "1234") return alert("Access Denied");

    const modal = document.getElementById('adminPanelModal');
    const listEl = document.getElementById('adminReportsList');
    const badge = document.getElementById('reportCountBadge');

    // 2. SUPER ADMIN CHECK (Second Layer)
    // Only show the Reset button if the user is You or Selva
    const resetBtn = document.getElementById('btnResetScores');
    if (currentUser && ADMIN_UIDS.includes(currentUser.uid)) {
        resetBtn.style.display = 'block'; // Show it
    } else {
        resetBtn.style.display = 'none';  // Keep it hidden
    }

    modal.classList.add('active');
    listEl.innerHTML = '<p style="text-align:center; padding:20px; color:#aaa;">Loading reports...</p>';

    try {
        // Query posts with > 0 reports
        const snap = await db.collection('posts')
            .where('reportCount', '>', 0)
            .orderBy('reportCount', 'desc')
            .get();

        badge.innerText = `${snap.size} Issues`;

        if (snap.empty) {
            listEl.innerHTML = `
                <div style="text-align:center; padding:40px; opacity:0.6;">
                    <div style="font-size:40px;">✅</div>
                    <p style="color:#fff;">All clear! No reported posts.</p>
                </div>`;
            return;
        }

        let html = '';
        snap.forEach(doc => {
            const p = doc.data();
            let urgencyColor = '#ff453a';
            if (p.reportCount > 5) urgencyColor = '#ff0000';
            if (p.reportCount > 10) urgencyColor = '#ff00d4';

            html += `
            <div class="card" style="border: 1px solid ${urgencyColor}; background: #1a0505; margin-bottom: 15px;">
                <div class="card-header" style="color: ${urgencyColor}; font-size:14px; display:flex; align-items:center; gap:8px;">
                    <span><b>${p.reportCount} Reports</b></span>
                    ${p.reportCount > 5 ? '<span class="badge" style="background:red; color:white;">URGENT</span>' : ''}
                </div>
                <div class="card-body" style="color: #ddd;">
                    <div style="font-weight:bold; margin-bottom:5px; font-size:16px;">${p.title}</div>
                    <p style="font-size:13px; opacity:0.8; margin-bottom:10px; border-left:2px solid #555; padding-left:10px;">${p.body}</p>
                    
                    ${p.imageUrl ? `<img src="${p.imageUrl}" style="height:120px; border-radius:8px; border:1px solid #333; margin-top:5px;">` : ''}
                    
                    <div style="margin-top:10px; font-size:11px; color:#888; border-top:1px solid #333; padding-top:8px;">
                        Posted by: <b style="color:#fff;">${p.authorName}</b> (${p.authorRole})<br>
                        Posted: ${p.createdAt ? p.createdAt.toDate().toLocaleString() : 'N/A'}
                    </div>
                </div>
                <div class="card-footer" style="gap: 10px; border-top:1px solid rgba(255, 69, 58, 0.2);">
                    <button class="btn btn-secondary" style="flex:1; font-size:12px;" onclick="adminIgnoreReport('${doc.id}')">
                        ✅ Ignore
                    </button>
                    <button class="btn btn-danger" style="flex:1; font-size:12px;" onclick="adminDeletePost('${doc.id}')">
                         Ban & Delete
                    </button>
                </div>
            </div>`;
        });

        listEl.innerHTML = html;

    } catch (e) {
        console.error(e);
        listEl.innerHTML = `<p style="color:red; text-align:center;">Error: ${e.message}</p>`;
    }
}
// --- FORGOT PASSWORD LOGIC ---
let recoveryState = {
    email: "",
    otp: null,
    userId: null
};

function openForgotModal() {
    resetFpsUI();
    document.getElementById('forgotPasswordModal').classList.add('active');
}

function closeForgotModal() {
    document.getElementById('forgotPasswordModal').classList.remove('active');
}

function resetFpsUI() {
    document.getElementById('fpStep1').classList.remove('hidden');
    document.getElementById('fpStep2').classList.add('hidden');
    document.getElementById('fpStep3').classList.add('hidden');
    document.getElementById('fpEmail').value = "";
    document.getElementById('fpOtpInput').value = "";
    document.getElementById('fpNewPass').value = "";
    document.getElementById('fpConfirmPass').value = "";
    recoveryState = { email: "", otp: null, userId: null };
}

function handleFpsSendOTP() {
    const email = document.getElementById('fpEmail').value.trim().toLowerCase();
    if (!email) return alert("Please enter email.");

    const btn = document.querySelector('#fpStep1 button');
    const originalText = btn.innerText;
    btn.innerText = "Sending...";
    btn.disabled = true;

    // 1. Check if user exists in Firestore
    db.collection('users').where('email', '==', email).get()
        .then(snap => {
            if (snap.empty) {
                alert("No account found with this email.");
                btn.innerText = originalText;
                btn.disabled = false;
                return;
            }

            const doc = snap.docs[0];
            const userData = doc.data();

            // Save state for later steps
            recoveryState.email = email;
            recoveryState.userId = doc.id;

            // 2. Generate Real OTP
            recoveryState.otp = Math.floor(100000 + Math.random() * 900000);

            // 3. SEND REAL EMAIL VIA EMAILJS
            const templateParams = {
                name: userData.name || "Student",
                email_to: email,      // The user's email
                otp: recoveryState.otp // The variable {{otp}} in your template
            };

            // REPLACE THESE WITH YOUR IDs
            const SERVICE_ID = "Sidd@1604";
            const TEMPLATE_ID = "template_f0etwxd"; // e.g., template_9z....

            return emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams);
        })
        .then((response) => {
            if (!response) return; // Handle case where user wasn't found above

            console.log('SUCCESS!', response.status, response.text);
            showToast("OTP sent to your email!");

            // Switch UI to Step 2
            document.getElementById('fpStep1').classList.add('hidden');
            document.getElementById('fpStep2').classList.remove('hidden');

            btn.innerText = originalText;
            btn.disabled = false;
        })
        .catch((error) => {
            console.error('FAILED...', error);
            alert("Failed to send email. Check console for details.");
            btn.innerText = originalText;
            btn.disabled = false;
        });
}
function getRoleBadgeHtml(rawRole) {
    const role = (rawRole || "student").toLowerCase();

    // 1. MENTOR BADGE (Green/Verified Look)
    if (role === 'mentor') {
        return `<span class="badge badge-verified" style="font-size:9px; padding:1px 6px; margin-left:4px; vertical-align:middle;">MENTOR</span>`;
    }

    // 2. STUDENT BADGE (Default Grey)
    return `<span class="badge" style="font-size:9px; padding:1px 6px; background:rgba(255,255,255,0.1); color:#ccc; border:1px solid var(--border-color); margin-left:4px; vertical-align:middle;">STUDENT</span>`;
}

function handleFpsVerifyOTP() {

    const inputOtp = document.getElementById('fpOtpInput').value;
    if (parseInt(inputOtp) === recoveryState.otp) {
        // Success
        document.getElementById('fpStep2').classList.add('hidden');
        document.getElementById('fpStep3').classList.remove('hidden');
    } else {
        alert("Incorrect OTP. Please try again.");
    }
}

function handleFpsSavePassword() {
    const pass1 = document.getElementById('fpNewPass').value;
    const pass2 = document.getElementById('fpConfirmPass').value;

    if (pass1.length < 6) return alert("Password must be at least 6 characters.");
    if (pass1 !== pass2) return alert("Passwords do not match.");

    // Update Database
    db.collection('users').doc(recoveryState.userId).update({
        password: pass1, // Saving directly as per your demo requirement
        updatedAt: new Date()
    }).then(() => {
        showToast("✅ Password Reset Successfully!");
        closeForgotModal();
        // Optionally autofill the login box
        document.getElementById('loginEmail').value = recoveryState.email;
        document.getElementById('loginPassword').value = "";
    }).catch(e => {
        console.error(e);
        alert("Failed to update password.");
    });
}

// Action: Delete the post permanently
function adminDeletePost(postId) {
    if (!confirm("Permanently delete this post?")) return;

    db.collection('posts').doc(postId).delete().then(() => {
        showToast("Content removed.");
        // Refresh the panel
        openAdminPanel();
    }).catch(e => alert(e.message));
}

// Action: Keep the post (Clear reports)
function adminIgnoreReport(postId) {
    if (!confirm("Clear reports and keep this post?")) return;

    db.collection('posts').doc(postId).update({
        reportCount: 0,
        reports: [] // Clear the array of reporters
    }).then(() => {
        showToast("Reports cleared.");
        openAdminPanel(); // Refresh
    }).catch(e => alert(e.message));
}
function insertEmoji(emoji) {
    const input = document.getElementById('messageText');
    input.value += emoji;
    input.focus();
}
// --- NAVBAR & USER INFO ---
function updateUserInfo() {
    if (window.currentUserData) {
        const data = window.currentUserData;

        let displayName, picUrl;

        if (data.isAnonymousSession) {
            displayName = "Anonymous";
            // QUESTION MARK AVATAR
            document.getElementById('navProfileContainer').innerHTML = `<div style="font-size:20px; font-weight:bold;">?</div>`;
            document.getElementById('navProfileContainer').style.backgroundImage = 'none';
            document.getElementById('navProfileContainer').style.border = '2px dashed #666';
        } else {
            displayName = (data.name || "User").charAt(0).toUpperCase() + (data.name || "User").slice(1);
            picUrl = data.profilePic;

            const profileIcon = document.getElementById('navProfileContainer');
            profileIcon.style.border = '1px solid var(--border-color)';
            if (picUrl) {
                profileIcon.innerHTML = `<img src="${picUrl}" class="navbar-pic">`;
            } else {
                profileIcon.innerHTML = displayName.charAt(0);
            }
        }

        document.getElementById('userInfo').textContent = `${displayName}`;
    }
}
/* --- OPEN USER PROFILE (Global) --- */
let currentViewedUserId = null;

function openUserProfile(targetUserId) {
    // 1. Prevent opening if it's me (optional: or redirect to My Profile tab)
    if (currentUser && targetUserId === currentUser.uid) {
        switchTab('profile');
        return;
    }

    currentViewedUserId = targetUserId;
    lockScroll();

    const modal = document.getElementById('viewProfileModal');
    modal.classList.add('active');

    // Reset UI
    document.getElementById('viewProfilePicContainer').innerHTML = '...';
    document.getElementById('viewProfileName').innerText = 'Loading...';
    document.getElementById('viewProfileActions').innerHTML = '<button class="btn btn-secondary" disabled>Checking status...</button>';
    document.getElementById('viewSkillsContainer').innerHTML = '';

    // 2. Fetch User Data
    db.collection('users').doc(targetUserId).get().then(async (doc) => {
        if (!doc.exists) {
            alert("User not found.");
            closeModal('viewProfileModal');
            return;
        }

        const u = doc.data();

        // RENDER HEADER
        document.getElementById('viewProfileName').innerHTML = u.name + (u.isVerified ? ' <span style="color:#30D158">✔</span>' : '');

        // Render Badge
        const badge = document.getElementById('viewProfileBadge');
        if (u.role === 'mentor') {
            badge.innerText = u.isVerified ? "VERIFIED MENTOR" : "MENTOR";
            badge.className = u.isVerified ? "badge badge-verified" : "badge";
            badge.style.background = u.isVerified ? "rgba(48, 209, 88, 0.2)" : "rgba(255,255,255,0.1)";
            badge.style.color = u.isVerified ? "#30D158" : "#ccc";
        } else {
            badge.innerText = "STUDENT";
            badge.className = "badge";
            badge.style.background = "rgba(255,255,255,0.1)";
            badge.style.color = "#ccc";
        }

        // Render Pic
        const picContainer = document.getElementById('viewProfilePicContainer');
        if (u.profilePic) {
            picContainer.innerHTML = `<img src="${u.profilePic}" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
            picContainer.innerHTML = `<div style="font-size:40px; color:#888; font-weight:bold;">${u.name.charAt(0).toUpperCase()}</div>`;
        }

        // Render Info
        document.getElementById('viewInfoCollege').innerText = u.college || "N/A";
        document.getElementById('viewInfoYear').innerText = u.year || "N/A";
        if (u.joinedDate) {
            const d = u.joinedDate.toDate ? u.joinedDate.toDate() : new Date(u.joinedDate);
            document.getElementById('viewInfoJoined').innerText = d.toLocaleDateString();
        }

        // Render Skills
        const skillsContainer = document.getElementById('viewSkillsContainer');
        if (u.skills && u.skills.length > 0) {
            skillsContainer.innerHTML = u.skills.map(s => `<span class="skill-tag-new">${s}</span>`).join('');
        } else {
            skillsContainer.innerHTML = '<span style="color:#666; font-size:13px;">No skills listed.</span>';
        }

        // 3. Fetch Stats (Async)
        // Posts
        db.collection('posts').where('authorId', '==', targetUserId).get().then(snap => {
            document.getElementById('viewStatPosts').innerText = snap.size;
        });
        // Score (already in user doc usually, but fallback to 0)
        document.getElementById('viewStatScore').innerText = u.score || 0;

        // Connections Count
        const sentP = db.collection('connection_requests').where('senderId', '==', targetUserId).where('status', '==', 'accepted').get();
        const recP = db.collection('connection_requests').where('recipientId', '==', targetUserId).where('status', '==', 'accepted').get();
        Promise.all([sentP, recP]).then(([s, r]) => {
            document.getElementById('viewStatConnections').innerText = s.size + r.size;
        });

        // 4. DETERMINE CONNECTION STATUS (The Logic)
        const actionsDiv = document.getElementById('viewProfileActions');

        // Check Sent Request
        const sentCheck = await db.collection('connection_requests')
            .where('senderId', '==', currentUser.uid)
            .where('recipientId', '==', targetUserId).get();

        // Check Received Request
        const recCheck = await db.collection('connection_requests')
            .where('recipientId', '==', currentUser.uid)
            .where('senderId', '==', targetUserId).get();

        let html = '';

        if (!sentCheck.empty) {
            const req = sentCheck.docs[0].data();
            if (req.status === 'pending') {
                html = `<button class="btn btn-disabled" disabled>Requested</button> 
                        <button class="btn btn-secondary" onclick="cancelRequest('${sentCheck.docs[0].id}')">Cancel</button>`;
            } else if (req.status === 'accepted') {
                html = `<button class="btn btn-primary" onclick="goToChatFromModal('${targetUserId}', '${encodeURIComponent(u.name)}')">Message</button>
                        <button class="btn btn-danger" onclick="unfriend('${targetUserId}', '${sentCheck.docs[0].id}')">Unfriend</button>`;
            } else {
                // Rejected, allow retry?
                html = `<button class="btn btn-primary" onclick="sendInstantConnectionRequest('${targetUserId}', this)">Connect</button>`;
            }
        }
        else if (!recCheck.empty) {
            const req = recCheck.docs[0].data();
            const reqId = recCheck.docs[0].id;
            if (req.status === 'pending') {
                html = `<button class="btn btn-primary" onclick="updateRequest('${reqId}','accepted','${targetUserId}')">Accept</button>
                        <button class="btn btn-danger" onclick="updateRequest('${reqId}','rejected')">Decline</button>`;
            } else if (req.status === 'accepted') {
                html = `<button class="btn btn-primary" onclick="goToChatFromModal('${targetUserId}', '${encodeURIComponent(u.name)}')">Message</button>
                        <button class="btn btn-danger" onclick="unfriend('${targetUserId}', '${reqId}')">Unfriend</button>`;
            } else {
                html = `<button class="btn btn-primary" onclick="sendInstantConnectionRequest('${targetUserId}', this)">Connect</button>`;
            }
        }
        else {
            // No connection exists
            html = `<button class="btn btn-primary" style="padding: 10px 30px;" onclick="sendInstantConnectionRequest('${targetUserId}', this)">Connect</button>`;
        }

        actionsDiv.innerHTML = html;

    }).catch(e => console.error(e));
}

function shareViewedProfile() {
    const name = document.getElementById('viewProfileName').innerText;
    if (navigator.share) {
        navigator.share({
            title: `Check out ${name} on V-SYNC`,
            text: `Connect with ${name}, a student on V-SYNC!`,
            url: window.location.href
        });
    } else {
        alert("Sharing not supported on this device.");
    }
}


// --- CONNECTIONS MODAL ---
function openConnectionsModal() {
    document.getElementById('connectionsModal').classList.add('active');
    loadConnections();
}

function loadConnections() {
    const listEl = document.getElementById('connectionsModalList');
    listEl.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">Loading...</p>';

    const sentPromise = db.collection('connection_requests').where('senderId', '==', currentUser.uid).where('status', '==', 'accepted').get();
    const receivedPromise = db.collection('connection_requests').where('recipientId', '==', currentUser.uid).where('status', '==', 'accepted').get();

    Promise.all([sentPromise, receivedPromise]).then(async ([sentSnap, receivedSnap]) => {
        const allDocs = [...sentSnap.docs, ...receivedSnap.docs];

        if (allDocs.length === 0) {
            listEl.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">No connections yet.</p>';
            return;
        }

        const renderPromises = allDocs.map(async (doc) => {
            const data = doc.data();
            let otherId;

            if (data.senderId === currentUser.uid) {
                otherId = data.recipientId;
            } else {
                otherId = data.senderId;
            }

            // Fetch profile data
            let otherUser = null;
            try {
                const userSnap = await db.collection('users').doc(otherId).get();
                if (userSnap.exists) {
                    otherUser = userSnap.data();
                } else {
                    return ''; // User deleted, skip rendering
                }
            } catch (e) {
                console.error("Error fetching user:", e);
                return ''; // Skip on error
            }

            const rawName = otherUser.name || "Unknown User";
            const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            const safeNameEncoded = encodeURIComponent(displayName);

            const role = (otherUser.role || "Student").charAt(0).toUpperCase() + (otherUser.role || "Student").slice(1);
            const yearBadge = getYearBadgeHtml(otherUser.year); // Helper function must exist

            let avatarHtml;
            if (otherUser.profilePic) {
                avatarHtml = `<img src="${otherUser.profilePic}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:1px solid var(--border-color); cursor:pointer;" onclick="openUserProfile('${otherId}')">`;
            } else {
                const initial = displayName.charAt(0);
                avatarHtml = `<div style="width:40px; height:40px; border-radius:50%; background:#333; display:flex; align-items:center; justify-content:center; color:#ccc; font-weight:bold; font-size:16px; border:1px solid var(--border-color); cursor:pointer;" onclick="openUserProfile('${otherId}')">${initial}</div>`;
            }

            return `
            <div class="card" style="margin-bottom: 10px; padding: 15px;">
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                    ${avatarHtml}
                    <div>
                        <div style="color:var(--text-main); font-weight:700; font-size:15px; line-height:1.2; cursor:pointer;" onclick="openUserProfile('${otherId}')">
                            ${displayName}
                        </div>
                        <div style="display:flex; align-items:center; gap:5px; margin-top:2px;">
                            <span class="badge badge-verified" style="font-size:9px; padding:1px 6px;">${role}</span>
                            ${yearBadge}
                        </div>
                    </div>
                </div>

                <div style="display:flex; gap:10px;">
                    <button class="btn btn-primary" style="flex:1; padding:8px; font-size:13px;" onclick="goToChatFromModal('${otherId}', '${safeNameEncoded}')">Message</button>
                    <button class="btn btn-danger" style="padding:8px; font-size:13px;" onclick="unfriend('${otherId}', '${doc.id}')">Unfriend</button>
                </div>
            </div>`;
        });

        const renderedItems = await Promise.all(renderPromises);
        listEl.innerHTML = renderedItems.join('');

    }).catch(e => {
        console.error("Error loading connections:", e);
        listEl.innerHTML = '<p style="color:var(--danger-color); text-align:center;">Failed to load.</p>';
    });
}

function goToChatFromModal(userId, encodedName) {
    // Close the connections popup
    document.getElementById('connectionsModal').classList.remove('active');

    // Decode the name back to normal
    const userName = decodeURIComponent(encodedName);

    // Open the chat
    goToChat(userId, userName);
}

function goToChat(userId, userName) {
    switchTab('chats');
    const chatId = [currentUser.uid, userId].sort().join('_');
    const chatRef = db.collection('chats').doc(chatId);

    chatRef.get().then(doc => {
        if (!doc.exists) {
            console.log("Creating new blank chat...");
            // Create blank document without system message
            return chatRef.set({
                participants: [currentUser.uid, userId],
                updatedAt: new Date(),
                lastMessage: ""
            }, { merge: true });
        }
    }).then(() => {
        loadChats();
        openInlineChat(chatId, userName);
    }).catch(e => {
        console.error("Error entering chat:", e);
        alert("Could not open chat.");
    });
}

// --- EXPLORE & SEARCH ---
function loadMentors() {
    const listEl = document.getElementById('searchResultsList');
    listEl.innerHTML = '<p style="text-align: center; grid-column: 1 / -1; color: var(--text-secondary);">Loading connections...</p>';

    const usersPromise = db.collection('users').get();
    const requestsPromise = db.collection('connection_requests').where('recipientId', '==', currentUser.uid).get();
    const sentRequestsPromise = db.collection('connection_requests').where('senderId', '==', currentUser.uid).get();

    Promise.all([usersPromise, requestsPromise, sentRequestsPromise]).then(([userSnap, receivedReqSnap, sentReqSnap]) => {
        const allRequests = [...receivedReqSnap.docs, ...sentReqSnap.docs];

        // --- 1. FILTER LOGIC START ---
        // Convert snapshot to array of docs
        let filteredDocs = userSnap.docs;

        // A. Filter by Role
        if (window.exploreFilters.roles.length > 0) {
            filteredDocs = filteredDocs.filter(doc => {
                const r = (doc.data().role || 'student').toLowerCase();
                return window.exploreFilters.roles.includes(r);
            });
        }

        // B. Filter by Year
        if (window.exploreFilters.years.length > 0) {
            filteredDocs = filteredDocs.filter(doc => {
                const y = doc.data().year;
                return window.exploreFilters.years.includes(y);
            });
        }

        // C. Filter by College
        if (window.exploreFilters.colleges.length > 0) {
            filteredDocs = filteredDocs.filter(doc => {
                const c = doc.data().college;
                return window.exploreFilters.colleges.includes(c);
            });
        }
        // --- FILTER LOGIC END ---

        renderUserResults(filteredDocs, allRequests); // Pass ARRAY, not snapshot
    }).catch(e => {
        listEl.innerHTML = '<p style="color:var(--danger-color); text-align:center;">Failed to load.</p>';
        console.error("Error in loadMentors:", e);
    });
}

function handleUserSearch(event) {
    // 1. Prevent page refresh if "Enter" is pressed
    if (event) event.preventDefault();

    // 2. Get the search term and make it lowercase (Case Insensitive)
    const searchInput = document.getElementById('searchInput');
    const term = searchInput.value.toLowerCase().trim();

    // 3. Get the list of cards currently on screen
    const listEl = document.getElementById('searchResultsList');
    const cards = listEl.getElementsByClassName('card');

    // 4. Loop through every card and toggle visibility (Real-Time)
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        // Get all text inside the card (Name, College, Role)
        const text = card.textContent || card.innerText;

        // Check if the text matches the search term
        if (text.toLowerCase().indexOf(term) > -1) {
            card.style.display = ""; // Show
        } else {
            card.style.display = "none"; // Hide
        }
    }
}

function unfriend(otherId, reqId) {
    showConfirm(
        "Disconnect User?",
        "Are you sure you want to disconnect? Chat history will be deleted.",
        () => {
            const batch = db.batch();
            const chatId = [currentUser.uid, otherId].sort().join('_');

            batch.delete(db.collection('connection_requests').doc(reqId));
            batch.delete(db.collection('chats').doc(chatId));

            batch.commit().then(() => {
                document.getElementById('connectionsModal').classList.remove('active');

                // UI Cleanup
                const currentOpenChat = document.getElementById('selectedChatId').value;
                if (currentOpenChat === chatId) {
                    document.getElementById('chatHeader').textContent = "Select a chat to begin.";
                    document.getElementById('messagesContainer').innerHTML = "";
                    document.getElementById('sendMessageForm').classList.add('hidden');
                    if (msgUnsub) msgUnsub();
                }
                loadMentors();
                loadChats();
            }).catch(e => alert("Error disconnecting: " + e.message));
        }
    );
}

function renderUserResults(snapshot, allRequests = []) {
    const listEl = document.getElementById('searchResultsList');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    let html = '';

    const DEFAULT_PIC = "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png";

    // --- STEP 1: PRE-PROCESS REQUESTS ---
    const connectedIds = new Set();
    const requestMap = new Map();

    allRequests.forEach(reqDoc => {
        const d = reqDoc.data();
        const isSender = d.senderId === currentUser.uid;
        const otherId = isSender ? d.recipientId : d.senderId;

        if (d.status === 'accepted') {
            connectedIds.add(otherId);
        } else if (d.status === 'pending') {
            requestMap.set(otherId, { ...d, docId: reqDoc.id });
        }
    });

    // --- STEP 2: RENDER USERS ---
    snapshot.forEach(doc => {
        const user = doc.data();
        const targetUserId = doc.id;

        if (!user || targetUserId === currentUser.uid) return;
        if (connectedIds.has(targetUserId)) return;

        // Search Filter
        let rawName = user.name;
        if (!rawName || rawName === 'undefined') rawName = 'Unknown User';
        if (searchTerm && !rawName.toLowerCase().includes(searchTerm)) return;

        const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/'/g, "\\'");
        const profileSrc = user.profilePic || DEFAULT_PIC;
        const role = (user.role || 'N/A').toUpperCase();

        // 1. Badge Logic
        let badgeHtml = '';
        if (user.role === 'mentor' && user.isVerified) {
            badgeHtml = `<span class="badge badge-verified" style="margin-left:5px;">MENTOR ✔</span>`;
        } else {
            badgeHtml = `<span class="badge" style="margin-left:5px; background:rgba(255,255,255,0.1); color:#999; border:1px solid var(--border-color);">${role}</span>`;
        }

        // 2. Subtext Logic
        let subtextHtml = '';
        if (user.expertise && Array.isArray(user.expertise) && user.expertise.length > 0) {
            const expString = user.expertise.join(' | ');
            subtextHtml = `<p style="font-size:13px; color:var(--text-secondary); margin-top:2px; line-height:1.4;">${expString}</p>`;
        } else {
            const fallbackText = user.role === 'student' ? `Student • ${user.year || 'N/A'}` : 'No experience listed';
            subtextHtml = `<p style="font-size:13px; color:var(--text-secondary); margin-top:2px;">${fallbackText}</p>`;
        }

        // 3. Button Logic
        let buttonHtml;
        const existingRequest = requestMap.get(targetUserId);

        if (existingRequest) {
            if (existingRequest.senderId === currentUser.uid) {
                buttonHtml = `
                <button class="btn btn-disabled" style="width:100%" disabled>Requested</button>
                <button class="btn btn-danger" style="width:100%; margin-top:10px;" onclick="cancelRequest('${existingRequest.docId}')">Cancel</button>`;
            } else {
                buttonHtml = `
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button class="btn btn-primary" style="flex:1" onclick="updateRequest('${existingRequest.docId}','accepted','${targetUserId}')">Accept</button>
                    <button class="btn btn-danger" style="flex:1" onclick="updateRequest('${existingRequest.docId}','rejected')">Decline</button>
                </div>`;
            }
        } else {
            buttonHtml = `<button class="btn btn-primary" style="width:100%; margin-top:15px;" onclick="sendInstantConnectionRequest('${targetUserId}', this)">Connect</button>`;
        }

        // 4. HTML Generation (Added onclick events to Image and Header)
        html += `
        <div class="card animate-item">
            <div class="card-content-wrapper">
                <img src="${profileSrc}" 
                     loading="lazy" 
                     class="card-avatar" 
                     alt="Profile" 
                     crossorigin="anonymous" 
                     onload="applyCardTheme(this)"
                     onclick="openUserProfile('${targetUserId}')" 
                     style="cursor: pointer;">
                
                <div style="width:100%; text-align:left; padding-left:10px;">
                    <div class="card-header" onclick="openUserProfile('${targetUserId}')" style="cursor:pointer; font-size:18px; margin-bottom:4px; justify-content:flex-start; gap:8px; align-items:center;">
                        ${displayName} 
                        ${badgeHtml}
                    </div>
                    
                    <p style="font-size:14px; color:var(--text-main); margin-bottom:2px; font-weight:500;">
                        ${user.college || 'N/A'}
                    </p>
                    
                    ${subtextHtml}
                </div>
            </div>
            <div class="card-footer" style="gap: 10px; margin-top: 0;">
                ${buttonHtml}
            </div>
        </div>`;
    });

    listEl.innerHTML = html || '<p style="text-align:center; grid-column: 1/-1; color: var(--text-secondary);">No new users found.</p>';
}

function sendInstantConnectionRequest(recipientId, btnElement) {
    // 1. IMMEDIATE VISUAL FEEDBACK (Optimistic UI)
    if (btnElement) {
        btnElement.textContent = "Requested";
        btnElement.disabled = true;
        btnElement.classList.add("btn-disabled");
        btnElement.onclick = null; // Prevent double-clicking
    }

    // 2. Fetch data and save
    const myId = currentUser.uid;

    // We fetch the target's name from DB to ensure no "undefined" or syntax errors
    db.collection('users').doc(recipientId).get().then(snap => {
        const targetData = snap.exists ? snap.data() : {};
        const targetName = targetData.name || "Unknown User";

        // Safe check for my name
        const myName = currentUserData.name || "Unknown User";

        return db.collection('connection_requests').add({
            senderId: myId,
            senderName: myName,
            recipientId: recipientId,
            recipientName: targetName,
            status: 'pending',
            subject: 'General Connection',
            message: "I'd like to connect with you on V-SYNC!",
            createdAt: new Date()
        });
    }).then(() => {
        console.log("Request successfully stored.");
        // 🚨 CRITICAL FIX: Do NOT reload loadMentors() here. 
        // Reloading immediately might fetch stale data and reset the button.
        // The visual update in step 1 is sufficient.
    }).catch(error => {
        console.error("Error sending request:", error);
        alert("Failed to send request.");
        // Revert button if error
        if (btnElement) {
            btnElement.textContent = "Connect";
            btnElement.disabled = false;
            btnElement.classList.remove("btn-disabled");
        }
    });
}

// --- REQUESTS TAB ---
// --- REQUESTS TAB LOGIC ---
function loadRequests() {
    const list = document.getElementById('requestsList');
    if (!list) return;

    list.innerHTML = '<p style="text-align:center; color:var(--text-secondary);">Loading requests...</p>';

    db.collection('connection_requests')
        .where('recipientId', '==', currentUser.uid)
        .get()
        .then(async (snap) => {
            const pendingDocs = snap.docs.filter(d => d.data().status === 'pending');

            if (pendingDocs.length === 0) {
                list.innerHTML = '<p style="text-align:center; color:var(--text-secondary);">No pending requests.</p>';
                return;
            }

            const renderPromises = pendingDocs.map(async (doc) => {
                const req = doc.data();

                // Fetch Sender Profile
                let senderUser = {};
                try {
                    const userSnap = await db.collection('users').doc(req.senderId).get();
                    if (userSnap.exists) senderUser = userSnap.data();
                } catch (e) { }

                const senderName = (senderUser.name || req.senderName || "Unknown").charAt(0).toUpperCase() + (senderUser.name || req.senderName || "User").slice(1);
                const dateStr = req.createdAt ? req.createdAt.toDate().toLocaleDateString() : 'Recently';

                // Badges
                const role = (senderUser.role || "Student").charAt(0).toUpperCase() + (senderUser.role || "Student").slice(1);
                const yearBadge = getYearBadgeHtml(senderUser.year);

                // Avatar
                let avatarHtml;
                if (senderUser.profilePic) {
                    // FIXED: Removed extra semicolons and fixed quote placement
                    avatarHtml = `<img src="${senderUser.profilePic}" loading="lazy" style="width:120px; height:120px; border-radius:50%; object-fit:cover; border:1px solid var(--border-color);">`;
                } else {
                    const initial = senderName.charAt(0);
                    avatarHtml = `<div style="width:100px; height:100px; border-radius:50%; background:#333; display:flex; align-items:center; justify-content:center; color:#ccc; font-weight:bold; font-size:18px; border:1px solid var(--border-color);">${initial}</div>`;
                }

                return `
                        <div class="card">
                            <div class="card-header" style="justify-content:flex-start; gap:12px; border-bottom:none; padding-bottom:0;">
                                ${avatarHtml}
                                <div>
                                    <div style="font-size:16px; font-weight:700;">${senderName}</div>
                                    <div style="display:flex; align-items:center; gap:5px; margin-top:3px;">
                                        
                                        <span class="badge" style="font-size:9px; background:rgba(255,255,255,0.1); color:#ccc;">${role}</span>
                                        ${yearBadge}
                                    </div>
                                </div>
                            </div>
                            
                            <div class="card-body" style="padding-top:10px; padding-left: 60px;"> <p style="font-style:italic; margin-bottom:5px;">"${req.message}"</p>
                                <small style="color:var(--text-secondary); font-size:11px;">Received: ${dateStr}</small>
                            </div>
                            
                            <div class="card-footer" style="gap: 10px; padding-left: 60px;"> <button class="btn btn-secondary" onclick="updateRequest('${doc.id}', 'accepted', '${req.senderId}')">Accept</button>
                                <button class="btn btn-danger" onclick="updateRequest('${doc.id}', 'rejected')">Decline</button>
                            </div>
                        </div>`;
            });

            const html = await Promise.all(renderPromises);
            list.innerHTML = html.join('');
        })
        .catch(e => {
            console.error("Error loading requests:", e);
            list.innerHTML = '<p style="text-align:center; color:var(--danger-color);">Error loading requests.</p>';
        });
}
function lockScroll() {
    document.body.classList.add('no-scroll');
}

function unlockScroll() {
    document.body.classList.remove('no-scroll');
}
function cancelRequest(requestId) {
    if (!confirm("Cancel this connection request?")) return;
    db.collection('connection_requests').doc(requestId).delete()
        .then(() => {
            loadMentors(); // Refresh UI
        })
        .catch(e => console.error("Error cancelling:", e));
}

function updateRequest(id, status, otherId) {
    // 1. Show immediate feedback (Optional but good UX)
    if (typeof showToast === 'function') showToast(status === 'accepted' ? "Accepting..." : "Declining...");

    const updatePromise = db.collection('connection_requests').doc(id).update({ status: status });

    if (status === 'accepted') {
        updatePromise
            .then(() => createChat(otherId)) // Create the chat logic
            .then(() => {
                // 2. REFRESH ALL TABS
                loadRequests(); // Refresh Requests Tab
                loadChats();    // Refresh Chats Tab
                loadMentors();  // <--- CRITICAL FIX: Refresh Explore Tab

                if (typeof showToast === 'function') showToast("Connection Accepted!");
            })
            .catch(error => {
                console.error(error);
                alert("Failed to finalize connection.");
            });
    } else {
        // Handle Rejection
        updatePromise.then(() => {
            loadRequests();
            loadMentors();  // <--- CRITICAL FIX: Refresh Explore Tab
            if (typeof showToast === 'function') showToast("Request Declined");
        });
    }
}

// --- CHATS ---
function createChat(otherId) {
    const chatId = [currentUser.uid, otherId].sort().join('_');

    // Just create the document logic, NO system message added
    return db.collection('chats').doc(chatId).set({
        participants: [currentUser.uid, otherId],
        lastMessage: "", // Empty start
        updatedAt: new Date()
    }, { merge: true });
}

// --- LOAD CHATS (Connections + Active Conversations) ---
// --- LOAD CHATS (Clean UI - Search Connections + Active Conversations) ---
// --- 3. LOAD CHATS (With Green Dot & Search) ---
function loadChats() {
    const listEl = document.getElementById('chatsListContent');
    const searchTerm = document.getElementById('chatSearchInput').value.toLowerCase().trim();

    if (!searchTerm) listEl.innerHTML = '<p style="color:var(--text-secondary); padding:15px;">Loading...</p>';

    const sentPromise = db.collection('connection_requests').where('senderId', '==', currentUser.uid).where('status', '==', 'accepted').get();
    const receivedPromise = db.collection('connection_requests').where('recipientId', '==', currentUser.uid).where('status', '==', 'accepted').get();
    const chatsPromise = db.collection('chats').where('participants', 'array-contains', currentUser.uid).get();

    Promise.all([sentPromise, receivedPromise, chatsPromise]).then(async ([sentSnap, recSnap, chatsSnap]) => {
        const chatMap = {};

        // 1. Process Chats & Extract Time for Sorting
        chatsSnap.forEach(doc => {
            const data = doc.data();
            const otherId = data.participants.find(id => id !== currentUser.uid);

            // Get Sort Time (Handle Firestore Timestamp or Date)
            let sortTime = 0;
            if (data.updatedAt && data.updatedAt.toDate) {
                sortTime = data.updatedAt.toDate().getTime();
            } else if (data.updatedAt) {
                sortTime = new Date(data.updatedAt).getTime();
            }

            chatMap[otherId] = {
                ...data,
                id: doc.id,
                _sortTime: sortTime // Store for sorting
            };
        });

        // 2. Collect All Connections
        const connectedUserIds = new Set();
        sentSnap.forEach(doc => connectedUserIds.add(doc.data().recipientId));
        recSnap.forEach(doc => connectedUserIds.add(doc.data().senderId));

        // 3. Create a Sortable Array
        let conversationList = Array.from(connectedUserIds).map(otherId => {
            const chat = chatMap[otherId];
            return {
                otherId: otherId,
                // If chat exists, use its time. If new connection (no chat), use 0 (bottom).
                time: chat ? chat._sortTime : 0
            };
        });

        // 4. SORT: Descending Order (Newest First) [Instagram Style Bubble Up]
        conversationList.sort((a, b) => b.time - a.time);

        // 5. Render in Sorted Order
        const renderPromises = conversationList.map(async (item) => {
            const otherId = item.otherId;

            let otherUser = null;
            try {
                const uDoc = await db.collection('users').doc(otherId).get();
                if (uDoc.exists) otherUser = uDoc.data();
            } catch (e) { }

            if (!otherUser) return '';

            const name = (otherUser.name || 'User').toLowerCase();
            if (searchTerm && !name.includes(searchTerm)) return '';

            const displayName = otherUser.name.charAt(0).toUpperCase() + otherUser.name.slice(1);
            const role = (otherUser.role || '').toUpperCase();

            // Status Dot
            let statusColor = '#636366';
            if (otherUser.lastSeen) {
                const diffMins = (new Date() - otherUser.lastSeen.toDate()) / 60000;
                if (diffMins < 5) statusColor = '#30D158';
            }

            let avatarContent = otherUser.profilePic
                ? `<img src="${otherUser.profilePic}" loading="lazy" style="width:45px; height:45px; border-radius:50%; object-fit:cover; border:1px solid var(--border-color);">`
                : `<div style="width:45px; height:45px; border-radius:50%; background:black; color:white; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); font-weight:bold; font-size:18px;">${displayName.charAt(0)}</div>`;

            const avatarHtml = `
            <div style="position: relative; flex-shrink: 0;">
                ${avatarContent}
                <div style="position: absolute; bottom: 2px; right: 2px; width: 12px; height: 12px; background: ${statusColor}; border: 2px solid var(--bg-card); border-radius: 50%;"></div>
            </div>`;

            const existingChat = chatMap[otherId];
            const hasMessage = existingChat && existingChat.lastMessage && existingChat.lastMessage.trim() !== "";
            const lastMsg = hasMessage ? existingChat.lastMessage : 'Start a conversation';
            const msgColor = hasMessage ? 'var(--text-secondary)' : 'var(--primary-color)';
            const chatId = existingChat ? existingChat.id : [currentUser.uid, otherId].sort().join('_');

            // Unread Check
            const myReadTime = (existingChat && existingChat.lastRead && existingChat.lastRead[currentUser.uid])
                ? existingChat.lastRead[currentUser.uid].toDate()
                : new Date(0);
            const lastUpdate = existingChat && existingChat.updatedAt ? existingChat.updatedAt.toDate() : new Date(0);
            const isUnread = hasMessage && (lastUpdate > myReadTime) && (existingChat.lastSenderId !== currentUser.uid);

            return `
            <div class="card chat-item animate-item" onclick="openInlineChat('${chatId}', '${otherId}', '${displayName}')" 
                 style="cursor:pointer; padding: 15px; margin-bottom: 5px; display: flex; align-items: center; gap: 12px; user-select: none; border-left: ${isUnread ? '3px solid var(--primary-color)' : 'none'};"
                 oncontextmenu="showContextMenu(event, 'chat', '${chatId}')"
                 ontouchstart="startLongPress(event, 'chat', '${chatId}')"
                 ontouchend="cancelLongPress()"
                 ontouchmove="cancelLongPress()">

                ${avatarHtml}
                <div style="flex: 1; min-width: 0;">
                    <div style="display:flex; justify-content:space-between;">
                        <div style="font-weight: 600; font-size: 15px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${displayName} <span style="font-size: 11px; color: var(--text-secondary);">(${role})</span>
                        </div>
                        ${isUnread ? '<span style="width:8px; height:8px; background:var(--primary-color); border-radius:50%;"></span>' : ''}
                    </div>
                    <small style="color: ${msgColor}; display: block; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${lastMsg}
                    </small>
                </div>
            </div>`;
        });

        const renderedItems = await Promise.all(renderPromises);
        listEl.innerHTML = renderedItems.join('') || '<p style="color:var(--text-secondary); padding:15px;">No connections found.</p>';

    }).catch(e => {
        console.error(e);
        listEl.innerHTML = '<p style="color:var(--danger-color)">Error loading chats.</p>';
    });
}
/* --- FILE HELPERS --- */
function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
        return `<div class="file-icon-box pdf"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`;
    }
    // Default Doc Icon
    return `<div class="file-icon-box doc"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg></div>`;
}

function formatBytes(bytes, decimals = 1) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}
// Helper: Extract dominant color from an image file object
function getDominantColor(file) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);

        img.onload = function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 1;
            canvas.height = 1;

            // Draw image resized to 1x1 pixel to get average color
            ctx.drawImage(img, 0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

            // Convert to Hex
            const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
            resolve(hex);
        };

        img.onerror = () => resolve("#FF5722"); // Fallback color
    });
}
// --- ADMIN: WIPE EVERYTHING ---
async function adminWipeDB() {
    const code = prompt("Type 'CONFIRM' to delete ALL posts, chats, and users from the database.");
    if (code !== 'CONFIRM') return;

    const btn = document.querySelector('button[onclick="adminWipeDB()"]');
    const originalText = btn.innerText;
    btn.innerText = "Wiping Database...";
    btn.disabled = true;

    try {
        // 1. Delete All Users Config
        const users = await db.collection('users').get();
        const userBatch = db.batch();
        users.forEach(doc => userBatch.delete(doc.ref));
        await userBatch.commit();
        console.log("Users wiped.");

        // 2. Delete All Posts
        const posts = await db.collection('posts').get();
        const postBatch = db.batch();
        posts.forEach(doc => postBatch.delete(doc.ref));
        await postBatch.commit();
        console.log("Posts wiped.");

        // 3. Delete All Chats
        const chats = await db.collection('chats').get();
        const chatBatch = db.batch();
        chats.forEach(doc => chatBatch.delete(doc.ref));
        await chatBatch.commit();
        console.log("Chats wiped.");

        // 4. Delete Requests
        const reqs = await db.collection('connection_requests').get();
        const reqBatch = db.batch();
        reqs.forEach(doc => reqBatch.delete(doc.ref));
        await reqBatch.commit();
        console.log("Requests wiped.");

        alert("Database Wiped Clean. You can now register fresh accounts.");
        window.location.reload();

    } catch (e) {
        console.error(e);
        alert("Error wiping DB: " + e.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function deleteChat(chatId, event) {
    event.stopPropagation();
    if (confirm("Are you sure you want to delete this conversation?")) {
        db.collection('chats').doc(chatId).delete().then(() => {
            loadChats();
            if (document.getElementById('selectedChatId').value === chatId) {
                document.getElementById('chatHeader').textContent = "Select a chat to begin.";
                document.getElementById('messagesContainer').innerHTML = "";
                document.getElementById('sendMessageForm').classList.add('hidden');
            }
        });
    }
}



function handleSendMessage(e) {
    // 1. CRITICAL: Stop the page from reloading immediately
    if (e) e.preventDefault();

    // 2. Get Data
    const input = document.getElementById('messageText');
    const text = input.value.trim();
    const chatId = document.getElementById('selectedChatId').value;

    // 3. Validation Checks
    if (!text) return; // Don't send empty messages
    if (!chatId) {
        console.error("No chat ID selected");
        return;
    }
    if (!currentUser) {
        console.error("User not logged in");
        return;
    }

    // 4. Send Message to Firestore
    db.collection('chats').doc(chatId).collection('messages').add({
        text: text,
        senderId: currentUser.uid,
        timestamp: new Date()
    }).catch(err => console.error("Error sending msg:", err));

    // 5. Update Chat Metadata (Last Message & Sender)
    db.collection('chats').doc(chatId).update({
        lastMessage: text,
        updatedAt: new Date(),
        lastSenderId: currentUser.uid
    }).catch(err => console.error("Error updating chat:", err));

    // 6. Clear Input
    input.value = '';
    input.focus(); // Keep keyboard open
}


/* --- GLOBAL LOADING STATE --- */
let isCommunityLoading = false; // Add this to prevent double clicks

/* --- HELPER: Prevent HTML injection breakage --- */
function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}




/* --- LOAD COMMUNITY (Fixed: Files, Layout & No Double Load) --- */
async function loadCommunity(forceRefresh = false) {
    const listEl = document.getElementById('communityPostsList');
    if (!listEl) return;
    if (!currentUser) return;

    // 1. INSTANT LOAD CHECK: If posts exist & not forced, DO NOTHING.
    // This makes it feel "instant" like other tabs.
    if (!forceRefresh && listEl.children.length > 0 && !listEl.textContent.includes('No posts')) {
        return; 
    }

    // 2. PREVENT DOUBLE NETWORK CALLS
    if (isCommunityLoading) return;
    isCommunityLoading = true;

    // --- SKELETON LOADING STATE (Only if empty) ---
    if (listEl.innerHTML.trim() === '') {
        listEl.innerHTML = `
            <div class="card" style="padding: 20px; margin-bottom: 20px;">
                <div style="display:flex; gap:10px; margin-bottom:15px;">
                    <div class="skeleton skeleton-avatar"></div>
                    <div style="flex:1;">
                        <div class="skeleton skeleton-text" style="width: 40%;"></div>
                        <div class="skeleton skeleton-text" style="width: 20%;"></div>
                    </div>
                </div>
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-text"></div>
                <div class="skeleton skeleton-img" style="margin-top:10px;"></div>
            </div>`;
    }

    try {
        const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(50).get();
        let posts = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

        // --- FILTERS ---
        if (window.activeFilters && window.activeFilters.years.length > 0) {
            posts = posts.filter(p => window.activeFilters.years.includes(p.authorYear));
        }
        if (window.activeFilters && window.activeFilters.tags.length > 0) {
            posts = posts.filter(p => {
                if (!p.tags) return false;
                return p.tags.some(t => window.activeFilters.tags.includes(t.name));
            });
        }
        if (window.activeFilters && window.activeFilters.sortBy === 'upvotes') {
            posts.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
        } else {
            posts.sort((a, b) => b.createdAt - a.createdAt);
        }

        if (posts.length === 0) {
            listEl.innerHTML = `<p style="text-align:center; color:var(--text-secondary); margin-top:30px;">No posts found.</p>`;
            return;
        }

        const htmlPromises = posts.map(async p => {
            const isAuthor = currentUser && p.authorId === currentUser.uid;
            const isReportedByMe = p.reports && p.reports.includes(currentUser.uid);

            // --- VISUAL VARIABLES ---
            const isAnonPost = p.isAnonymous || p.authorName === "Anonymous" || p.authorRole === "Guest";
            const myData = window.currentUserData || {};

            const displayPic = isAuthor && !myData.isAnonymousSession ? (myData.profilePic || "") : (p.authorPic || "");
            const displayName = isAuthor && !myData.isAnonymousSession ? myData.name : p.authorName;
            const displayRole = isAuthor && !myData.isAnonymousSession ? (myData.role || "Student") : (p.authorRole || "Student");
            const displayYear = isAuthor && !myData.isAnonymousSession ? (myData.year || "") : (p.authorYear || "");

            const yearBadge = typeof getYearBadgeHtml === 'function' ? getYearBadgeHtml(displayYear) : `<span class="badge">${displayYear}</span>`;
            const timeString = typeof timeAgo === 'function' ? timeAgo(p.createdAt) : 'Just now';

            const clickAction = isAnonPost
                ? `onclick="showToast('This user is posting anonymously.')"`
                : `onclick="openUserProfile('${p.authorId}')"`;

            const cursorStyle = isAnonPost ? "cursor: default" : "cursor: pointer";

            let tagsHtml = '';
            if (p.tags && Array.isArray(p.tags)) {
                p.tags.forEach(tag => {
                    tagsHtml += `<span style="background:${tag.hex || '#555'}; color:white; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; margin-right:5px;">${tag.name}</span>`;
                });
            }

            // --- RESTORED FILE HANDLING LOGIC ---
            let mediaHtml = '';
            if (p.imageUrl) {
                let renderType = 'image';
                // 1. Check DB field first
                if (p.mediaType === 'video') renderType = 'video';
                else if (p.mediaType === 'document') renderType = 'document';
                else {
                    // 2. Fallback: Check URL extension
                    if (p.imageUrl.match(/\.(mp4|webm|mov|mkv)(\?.*)?$/i)) renderType = 'video';
                    else if (p.imageUrl.match(/\.(pdf|doc|docx|ppt|pptx|txt|csv|xls|xlsx|zip|rar)(\?.*)?$/i)) renderType = 'document';
                }

                // 3. Extract Filename if missing
                let displayFileName = p.fileName || "File";
                if (!p.fileName && renderType === 'document') {
                    try {
                        const urlPath = decodeURIComponent(p.imageUrl.split('?')[0]); 
                        displayFileName = urlPath.substring(urlPath.lastIndexOf('/') + 1);
                        if(displayFileName.match(/^\d+_/) && displayFileName.includes('_')) {
                            displayFileName = displayFileName.split('_').slice(1).join('_'); 
                        }
                    } catch(e){}
                }

                if (renderType === 'video') {
                    mediaHtml = `<video src="${p.imageUrl}" controls class="post-image" onclick="event.stopPropagation()"></video>`;
                } 
                else if (renderType === 'document') {
                    const sizeStr = typeof formatBytes === 'function' ? formatBytes(p.fileSize || 0) : '';
                    const iconHtml = typeof getFileIcon === 'function' ? getFileIcon(displayFileName) : '📄';
                    mediaHtml = `
                    <div class="file-attachment-card" onclick="forceDownload(event, '${p.imageUrl}', '${displayFileName}')" style="margin-top:10px; display:flex;">
                        ${iconHtml}
                        <div class="file-info">
                            <span class="file-name">${displayFileName}</span>
                            <div class="file-meta">${sizeStr ? sizeStr + ' • ' : ''}Tap to Download</div>
                        </div>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </div>`;
                } 
                else {
                    mediaHtml = `<img src="${p.imageUrl}" loading="lazy" class="post-image" onclick="event.stopPropagation(); openLightbox(this.src)">`;
                }
            }

            // --- HTML ESCAPING FOR SAFETY ---
            const safeBody = typeof escapeHtml === 'function' ? escapeHtml(p.body || "") : (p.body || ""); 
            const processedBody = safeBody.replace(/(https?:\/\/[^\s]+)/g, (url) => `<a href="${url}" target="_blank" style="color:var(--primary-color); text-decoration:underline;">${url}</a>`);

            let avatarHtml = displayPic && displayName !== "Anonymous"
                ? `<img src="${displayPic}" loading="lazy" class="post-avatar-small">`
                : `<div class="post-avatar-small" style="background:#333; display:flex; align-items:center; justify-content:center; color:#ccc; font-weight:bold;">${displayName.charAt(0)}</div>`;

            let topCommentHtml = '';
            try {
                const cSnap = await db.collection('posts').doc(p.id).collection('comments').orderBy('upvotes', 'desc').limit(1).get();
                if (!cSnap.empty) {
                    const c = cSnap.docs[0].data();
                    const safeAuthor = typeof escapeHtml === 'function' ? escapeHtml(c.authorName) : c.authorName;
                    const safeText = typeof escapeHtml === 'function' ? escapeHtml(c.text) : c.text;
                    topCommentHtml = `
                    <div class="top-comment-preview" onclick="viewPost('${p.id}')">
                        <div style="font-weight:bold; color:var(--text-main); font-size:12px; margin-bottom:2px;">
                            ${safeAuthor} <span style="font-weight:normal; color:var(--text-secondary);">commented:</span>
                        </div>
                        <div style="color:#ccc; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">"${safeText}"</div>
                    </div>`;
                }
            } catch (e) { }

            const myBookmarks = (myData.bookmarks || []);
            const isBookmarked = myBookmarks.includes(p.id);
            const bookmarkColor = isBookmarked ? '#FFD700' : 'currentColor';
            const bookmarkFill = isBookmarked ? '#FFD700' : 'none';
            const bookmarkClass = isBookmarked ? 'bookmarked' : '';

            const wallHtml = `
                <div id="wall-${p.id}" class="report-wall-container">
                    <div class="report-icon-large">⚠️</div>
                    <div class="report-text-large">You've reported this post</div>
                    <div style="display:flex; gap:15px;">
                         <button class="btn btn-secondary" onclick="hidePostLocally('${p.id}')">Hide Post</button>
                         <button class="btn btn-danger" style="background:transparent; border:1px solid #ff453a; color:#ff453a;" onclick="dismissReportWall('${p.id}')">Dismiss</button>
                    </div>
                </div>`;

            // --- BUILD POST CONTENT ---
            const contentHtml = `
                <div id="content-${p.id}" class="${isReportedByMe ? 'content-hidden' : ''}">
                    <div class="post-options-wrapper">
                        <div class="three-dots-btn" onclick="togglePostMenu(event, '${p.id}')">⋮</div>
                        <div id="menu-${p.id}" class="options-menu">
                            <div class="menu-item danger" onclick="reportPost(event, '${p.id}')">Report</div>
                            ${isAuthor ? `<div class="menu-item danger" onclick="deletePost('${p.id}')">Delete</div>` : ''}
                        </div>
                    </div>

                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.05); padding-right: 30px; ${cursorStyle};" ${clickAction}>
                        ${avatarHtml}
                        <div>
                            <div style="color:var(--text-main); font-weight:700; font-size:15px; line-height:1.2;">
                                ${displayName} <span class="badge badge-verified" style="font-size:9px;">${displayRole}</span>
                            </div>
                            <div style="color:var(--text-secondary); font-size:12px;">${yearBadge} • ${timeString}</div>
                        </div>
                    </div>

                    <div style="cursor:pointer;" onclick="viewPost('${p.id}')">
                        <div style="margin-bottom:8px;">
                            <div style="font-size:17px; font-weight:700; margin-bottom:6px;">${escapeHtml(p.title)}</div>
                            <div>${tagsHtml}</div>
                        </div>
                        <div class="card-body" style="white-space: pre-wrap; margin-top:0;">${processedBody}${mediaHtml}</div>
                        ${topCommentHtml}
                    </div>

                    <div class="card-footer" style="justify-content: space-between; margin-top:15px; align-items:center;">
                        <button class="btn btn-secondary ${bookmarkClass}" onclick="toggleBookmark(event, '${p.id}')" style="padding: 8px 12px; min-width: 40px; color: ${isBookmarked ? '#FFD700' : 'var(--text-secondary)'};">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="${bookmarkFill}" stroke="${bookmarkColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </button>

                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-secondary" onclick="viewPost('${p.id}')">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;">
                                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                                </svg>
                                Comment
                            </button>
                            <button class="btn ${currentUser && (p.upvoters || []).includes(currentUser.uid) ? 'btn-primary' : 'btn-secondary'}" onclick="handleUpvote(event, '${p.id}')">
                                ↑ ${p.upvotes || 0}
                            </button>
                        </div>
                    </div>
                </div>`; 

            // IMPORTANT: Return wrapper DIV with margin to fix nesting issues
            return `
            <div id="post-card-${p.id}" class="card animate-item" style="position: relative; display: block; margin-bottom: 20px;">
                ${isReportedByMe ? wallHtml : ''} 
                ${contentHtml}
            </div>`;
        });

        const finalHtml = await Promise.all(htmlPromises);
        listEl.innerHTML = finalHtml.join('');

    } catch (e) {
        console.error(e);
        listEl.innerHTML = '<p style="text-align:center; color:var(--danger-color);">Error loading posts.</p>';
    } finally {
        isCommunityLoading = false; // RELEASE LOCK
    }
}

// --- 2. FILTER & SORT UI LOGIC ---
// --- FIXED UPVOTE HANDLER ---
window.handleUpvote = function (event, postId) {
    triggerHaptic();
    event.stopPropagation(); // Prevent opening the post details

    // 1. Anon Check
    if (window.currentUserData && window.currentUserData.isAnonymousSession) {
        if (typeof showToast === 'function') showToast("Restricted: Cannot upvote as Anonymous.");
        else alert("Restricted.");
        return;
    }

    const btn = event.currentTarget;
    const isUpvoted = btn.classList.contains('btn-primary');
    const ref = db.collection('posts').doc(postId);

    // 2. UI Update (Immediate Visual Feedback)
    // Extract the current number from text "↑ 5" -> 5
    let count = parseInt(btn.innerText.replace(/\D/g, '')) || 0;

    if (isUpvoted) {
        // Remove Upvote
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.innerText = `↑ ${Math.max(0, count - 1)}`;

        // DB Update (Background)
        ref.update({
            upvotes: firebase.firestore.FieldValue.increment(-1),
            upvoters: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        });
    } else {
        // Add Upvote
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        btn.innerText = `↑ ${count + 1}`;

        // DB Update (Background)
        ref.update({
            upvotes: firebase.firestore.FieldValue.increment(1),
            upvoters: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        });
    }
};

function openSortModal() {
    lockScroll();
    const modal = document.getElementById('sortFilterModal');

    // --- ADD CLOSE BUTTON ---
    const header = modal.querySelector('.modal-header');
    if (header && !header.querySelector('.close-modal-btn')) {
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.innerHTML = `
                    <span>Sort & Filter</span>
                    <span class="close-modal-btn" onclick="closeModal('sortFilterModal')"style="font-size:24px; cursor:pointer; padding:0 10px;">&times;</span>
                `;
    }
    // ------------------------

    modal.classList.add('active');
    renderFilterTags();
    updateFilterUI();
}
// --- GLOBAL MODAL CLOSER (FIXES SCROLL LOCK) ---
window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // 1. Add the closing class to trigger CSS animations
    modal.classList.add('closing');

    // 2. Wait for the animation to finish (300ms) before hiding
    setTimeout(() => {
        modal.classList.remove('active');   // Hide display
        modal.classList.remove('closing');  // Reset animation state
        unlockScroll();                     // Re-enable body scrolling
    }, 280); // Slightly less than 300ms to prevent a flash at the end
};
// --- SYNC PROFILE CHANGES TO OLD POSTS ---
// --- SYNC PROFILE CHANGES TO OLD POSTS ---
/* --- FIXED SYNC FUNCTION (Protects Anonymous Posts) --- */
async function syncUserProfileToContent() {
    if (!currentUser) return;

    const uData = window.currentUserData;

    // Prepare the up-to-date data object
    const updates = {
        authorName: uData.name,
        authorPic: uData.profilePic || "",
        authorRole: uData.role || "Student",
        authorYear: uData.year || "",
        authorColor: uData.themeColor || "#FF5722"
    };

    console.log("Syncing profile...");

    try {
        const postsSnap = await db.collection('posts').where('authorId', '==', currentUser.uid).get();
        const batch = db.batch();
        let updateCount = 0;

        postsSnap.forEach(doc => {
            const p = doc.data();

            // 🚨 SECURITY CHECK: 
            // If the post was made by "Guest" (Anonymous) or explicitly flagged, DO NOT update it with real name.
            if (p.authorRole === 'Guest' || p.isAnonymous === true) {
                return; // Skip this post
            }

            batch.update(doc.ref, updates);
            updateCount++;
        });

        if (updateCount > 0) {
            await batch.commit();
            console.log(`Updated ${updateCount} public posts.`);
        } else {
            console.log("No public posts to update.");
        }

    } catch (e) {
        console.error("Sync error:", e);
    }
}

// Update uploadProfilePic to close modal on success
const originalUpload = window.uploadProfilePic; // Save ref if exists logic is complex

// Overwrite slightly to close modal
window.uploadProfilePic = function () {
    const fileInput = document.getElementById('fileInput');
    if (fileInput.files.length === 0) return;
    const file = fileInput.files[0];
    if (file.size > 2 * 1024 * 1024) return alert("File too large.");

    const reader = new FileReader();
    reader.onload = function (e) {
        const newPic = e.target.result;
        db.collection('users').doc(currentUser.uid).update({ profilePic: newPic, updatedAt: new Date() })
            .then(() => {
                if (window.currentUserData) window.currentUserData.profilePic = newPic;
                document.getElementById('profilePicModal').classList.remove('active');

                loadProfile();
                updateUserInfo();

                // TRIGGER SYNC
                syncUserProfileToContent();

                showToast("Profile Picture Updated");
            });
    };
    reader.readAsDataURL(file);
};

// Update removeProfilePic to close modal
window.removeProfilePic = function () {
    if (!confirm("Remove current photo?")) return;

    db.collection('users').doc(currentUser.uid).update({ profilePic: "" })
        .then(() => {
            if (window.currentUserData) window.currentUserData.profilePic = "";
            document.getElementById('profilePicModal').classList.remove('active');

            loadProfile();
            updateUserInfo();

            // TRIGGER SYNC
            syncUserProfileToContent();

            showToast("Photo Removed");
        });
};

/* --- FILTER APPLY FIX --- */
function applyFilters() {
    // 1. Close the modal properly (This triggers unlockScroll)
    closeModal('sortFilterModal');

    // 2. Reload the feed with the new filters
    loadCommunity();
}
function applyTheme(color) {
    document.documentElement.style.setProperty('--primary-color', color);
    // Add other variables if needed
}
/* --- MESSAGE NOTIFICATIONS --- */

let msgBadgeUnsub

/* --- FIXED BADGE LISTENER (Prevents Null Crash) --- */
function initMessageBadgeListener() {
    // 1. Initial Safety Check
    if (!currentUser) return;

    // 2. Clear previous listener if it exists
    if (msgBadgeUnsub) msgBadgeUnsub();

    // 3. Start Listener
    msgBadgeUnsub = db.collection('chats')
        .where('participants', 'array-contains', currentUser.uid)
        .onSnapshot(snap => {
            // 🚨 CRITICAL FIX: Check user again INSIDE the listener
            if (!currentUser) return;

            let unreadCount = 0;
            snap.forEach(doc => {
                const data = doc.data();
                // Safety checks for message data
                if (!data.lastMessage) return;
                if (data.lastSenderId === currentUser.uid) return;

                const lastUpdate = data.updatedAt ? data.updatedAt.toDate() : new Date(0);

                // Safe access to read time
                const myReadTime = (data.lastRead && data.lastRead[currentUser.uid])
                    ? data.lastRead[currentUser.uid].toDate()
                    : new Date(0);

                if (lastUpdate > myReadTime) {
                    unreadCount++;
                }
            });

            updateMessageBadgeUI(unreadCount);
        }, error => {
            console.log("Listener stopped:", error.message);
        });
}

function updateMessageBadgeUI(count) {
    const badge = document.getElementById('msgBadge');
    if (!badge) return;

    if (count > 0) {
        badge.innerText = count > 9 ? '9+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function clearAllFilters() {
    // 1. Reset the global filter state
    window.activeFilters = { sortBy: 'latest', years: [], tags: [] };

    // 2. Reset the visual "pills" inside the Sort Modal
    // (This ensures next time you open the menu, nothing is highlighted)
    if (typeof updateFilterUI === "function") updateFilterUI();
    if (typeof renderFilterTags === "function") renderFilterTags();

    // 3. IMPORTANT: Actually reload the feed to show posts again
    loadCommunity();
}

function toggleSort(type) {
    window.activeFilters.sortBy = type;
    updateFilterUI();
}
/* --- EXPLORE / MENTOR FILTER LOGIC --- */
window.exploreFilters = {
    roles: [],
    years: [],
    colleges: []
};

function openExploreSortModal() {
    lockScroll();
    const modal = document.getElementById('exploreFilterModal');
    modal.classList.add('active');
    updateExploreFilterUI();
}

function toggleExploreFilter(category, value) {
    const list = window.exploreFilters[category];
    const index = list.indexOf(value);

    if (index > -1) list.splice(index, 1); // Remove
    else list.push(value); // Add

    updateExploreFilterUI();
}

function updateExploreFilterUI() {
    // 1. Roles
    ['student', 'mentor'].forEach(r => {
        const btn = document.getElementById(`expRole_${r}`);
        if (btn) btn.className = `filter-pill ${window.exploreFilters.roles.includes(r) ? 'active' : ''}`;
    });

    // 2. Years
    ['FE', 'SE', 'TE', 'BE'].forEach(y => {
        const btn = document.getElementById(`expYear_${y}`);
        if (btn) btn.className = `filter-pill ${window.exploreFilters.years.includes(y) ? 'active' : ''}`;
    });

    // 3. Colleges
    ['VIT', 'VSIT', 'VP'].forEach(c => {
        const btn = document.getElementById(`expCol_${c}`);
        if (btn) btn.className = `filter-pill ${window.exploreFilters.colleges.includes(c) ? 'active' : ''}`;
    });
}

function clearExploreFilters() {
    window.exploreFilters = { roles: [], years: [], colleges: [] };
    updateExploreFilterUI();
    loadMentors(); // Reload list
}

function applyExploreFilters() {
    closeModal('exploreFilterModal');
    loadMentors(); // Trigger reload with new filters
}

function toggleFilter(type, value) {
    const list = type === 'year' ? window.activeFilters.years : window.activeFilters.tags;
    const index = list.indexOf(value);

    if (index > -1) list.splice(index, 1); // Remove
    else list.push(value); // Add

    updateFilterUI();
    if (type === 'tag') renderFilterTags(); // Re-render tag visuals
}

function updateFilterUI() {
    // 1. Update Sort Buttons
    document.getElementById('sortBtn_latest').className = `filter-pill ${window.activeFilters.sortBy === 'latest' ? 'active' : ''}`;
    document.getElementById('sortBtn_upvotes').className = `filter-pill ${window.activeFilters.sortBy === 'upvotes' ? 'active' : ''}`;

    // 2. Update Year Buttons
    ['FE', 'SE', 'TE', 'BE'].forEach(y => {
        const btn = document.getElementById(`yearBtn_${y}`);
        if (btn) btn.className = `filter-pill ${window.activeFilters.years.includes(y) ? 'active' : ''}`;
    });
}

function renderFilterTags() {
    const container = document.getElementById('filterTagsContainer');
    if (!container) return;

    // Use global TAG_DATA to generate the list
    let html = '';
    TAG_DATA.forEach(tag => {
        const isActive = window.activeFilters.tags.includes(tag.name);
        const style = isActive
            ? `background: ${tag.hex}; color: white; border-color: ${tag.hex};`
            : `border-left: 3px solid ${tag.hex};`; // Visual hint of color when inactive

        html += `
            <div class="filter-pill ${isActive ? 'active' : ''}" 
                 onclick="toggleFilter('tag', '${tag.name}')"
                 style="${style}">
                ${tag.name}
            </div>
        `;
    });
    container.innerHTML = html;
}



window.handleCreatePostSubmit = async function (e) {
    e.preventDefault();
    const submitBtn = document.getElementById('submitPostBtn');
    const originalText = submitBtn.innerText;

    submitBtn.disabled = true;
    submitBtn.innerText = "Publishing...";

    try {
        if (!window.currentUser || !window.currentUserData) {
            throw new Error("You must be logged in to post.");
        }

        const titleEl = document.getElementById('communityPostTitle');
        const bodyEl = document.getElementById('communityPostBody');
        const fileEl = document.getElementById('postFileInput');

        const title = titleEl ? titleEl.value : "Untitled";
        const body = bodyEl ? bodyEl.value : "";

        // --- 🛑 AUTO-MODERATION CHECK START ---
        if (containsSensitiveContent(title) || containsSensitiveContent(body)) {
            // 1. Log it to DB so Admins know who is being naughty (Optional)
            logModerationAttempt(title + " " + body, 'post');

            // 2. Fake a "Report" delay to scare them slightly
            setTimeout(() => {
                alert("🚫 POST REJECTED \n\nYour post contains prohibited language.\n\nThis action has been automatically reported to the Admin Council.");

                // Reset button
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
            }, 500);

            return; // STOP HERE. Do not upload to Firebase.
        }
        // --- 🛑 AUTO-MODERATION CHECK END ---

        // ... THE REST OF YOUR EXISTING CODE CONTINUES BELOW ...
        // (Prepare Tags, Upload Logic, DB Add, etc.)

        // Prepare Tags
        const safeTags = window.selectedTags || [];
        const finalTags = safeTags.map(t => ({
            name: t.text,
            color: t.colorClass,
            hex: t.hex
        }));

        let fileUrl = "";
        let mediaType = "image";

        if (fileEl && fileEl.files.length > 0) {
            const file = fileEl.files[0];
            mediaType = file.type.startsWith('video/') ? 'video' : 'image';
            submitBtn.innerText = "Uploading Media...";
            fileUrl = await uploadFileToStorage(file);
        }

        const isAnon = window.currentUserData.isAnonymousSession;
        const currentYear = isAnon ? window.currentUserData.realYear : window.currentUserData.year;

        await db.collection('posts').add({
            title: title,
            body: body,
            tags: finalTags,
            imageUrl: fileUrl,
            mediaType: mediaType,
            authorId: window.currentUser.uid,
            authorName: isAnon ? "Anonymous" : (window.currentUserData.name || "Anonymous"),
            authorRole: isAnon ? "Guest" : (window.currentUserData.role || "Student"),
            authorPic: isAnon ? "" : (window.currentUserData.profilePic || ""),
            isAnonymous: isAnon,
            authorYear: currentYear || "",
            upvotes: 0,
            upvoters: [],
            createdAt: new Date(),
            linkUrl: "",
            reportCount: 0, // Starts clean
            reports: []
        });

        console.log("Post saved successfully!");

        // Cleanup UI
        closeModal('createPostModal');
        if (titleEl) titleEl.value = "";
        if (bodyEl) bodyEl.value = "";
        if (window.removePostImage) window.removePostImage();
        window.selectedTags = [];
        if (window.renderTagsOnMainForm) window.renderTagsOnMainForm();
        if (window.loadCommunity) window.loadCommunity();

        submitBtn.disabled = false;
        submitBtn.innerText = "Post";

    } catch (error) {
        console.error("POST ERROR:", error);
        alert("Failed to post: " + error.message);
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    }
};

function deletePost(postId) {
    showConfirm(
        "Delete Post?",
        "This post will be permanently removed from the community.",
        () => {
            db.collection('posts').doc(postId).delete().then(() => loadCommunity());
        }
    );
}

function viewPost(id) {
    document.getElementById('currentPostId').value = id;
    db.collection('posts').doc(id).get().then(doc => {
        const p = doc.data();

        // --- NEW: Auto-Linkify for Modal View ---
        const processedBody = p.body.replace(/(https?:\/\/[^\s]+)/g, (url) => {
            return `<a href="${url}" target="_blank" style="color:var(--primary-color); text-decoration:underline;">${url}</a>`;
        });

        document.getElementById('postDetailTitle').textContent = p.title;
        // Use processedBody here
        document.getElementById('postDetailBody').innerHTML = `
            <p style="white-space: pre-wrap;">${processedBody}</p>
            ${p.linkUrl ? `<a href="${p.linkUrl}" target="_blank" class="post-link" style="margin-top:10px; display:inline-block;">🔗 ${p.linkUrl}</a>` : ''}
            <small style="color: #666; display:block; margin-top:10px;">By ${p.authorName}</small>
        `;

        loadComments(id);
        document.getElementById('postDetailModal').classList.add('active');
    });
}

function loadComments(postId) {
    const list = document.getElementById('commentsList');
    list.innerHTML = '<p style="color:var(--text-secondary);">Loading...</p>';

    // 1. Fetch Post (to get goatedCommentId + authorId) AND Comments
    const postPromise = db.collection('posts').doc(postId).get();
    const commentsPromise = db.collection('posts').doc(postId).collection('comments')
        .orderBy('timestamp', 'asc')
        .get();

    Promise.all([postPromise, commentsPromise]).then(([postSnap, commentsSnap]) => {
        if (!postSnap.exists) {
            list.innerHTML = "<p>Post not found.</p>";
            return;
        }

        const postData = postSnap.data();
        postData.id = postSnap.id; // Ensure ID is attached

        // Map comments
        let comments = commentsSnap.docs.map(d => ({ ...d.data(), id: d.id }));

        // 2. Render with knowledge of the Post (for permissions & pinning)
        renderThreadedComments(comments, list, postData);

    }).catch(err => console.error("Error loading comments:", err));
}

function renderThreadedComments(comments, container, postData) {
    container.innerHTML = '';

    const commentMap = {};
    const roots = [];

    // 1. Map comments
    comments.forEach(c => {
        commentMap[c.id] = c;
        c.children = [];
    });

    // 2. Build Tree
    comments.forEach(c => {
        if (c.parentId && commentMap[c.parentId]) {
            commentMap[c.parentId].children.push(c);
        } else {
            roots.push(c);
        }
    });

    // 3. Sort: GOAT first
    roots.sort((a, b) => {
        if (a.id === postData.goatedCommentId) return -1;
        if (b.id === postData.goatedCommentId) return 1;
        return 0;
    });

    // 4. Recursive Render Function
    // CHANGED: Now accepts 'targetContainer' to know where to put the element
    function createCommentNode(comment, targetContainer, level = 0) {

        // --- LOGIC ---
        const isGoated = (comment.id === postData.goatedCommentId);
        const isPostAuthor = (currentUser && currentUser.uid === postData.authorId);

        // Normalize Role for Logic (force lowercase)
        const rawRole = comment.authorRole || "Student";
        const roleLogic = rawRole.toLowerCase();
        const isMentor = roleLogic === 'mentor';

        // Generate Visual Badge
        const roleBadge = getRoleBadgeHtml(rawRole);

        // Upvote Logic
        const hasUpvoted = (comment.upvoters || []).includes(currentUser.uid);
        const btnClass = hasUpvoted ? 'btn-primary' : 'btn-secondary';

        const wrapper = document.createElement('div');
        wrapper.style.marginLeft = level > 0 ? (level * 10) + 'px' : '0';
        if (level > 0) wrapper.style.borderLeft = "2px solid var(--border-color)";

        // --- BUTTON LOGIC ---
        let goatBtn = '';
        // Only show button if: I am Author AND Target is Mentor AND it's a root comment
        if (isPostAuthor && isMentor && level === 0) {
            const btnText = isGoated ? 'Un-Goat' : '🏆 Mark GOAT';
            goatBtn = `
            <button onclick="toggleGoatStatus('${postData.id}', '${comment.id}', '${roleLogic}')" 
                class="btn btn-sm" 
                style="margin-left:auto; font-size:10px; border:1px solid #FFD700; color:#FFD700; background:transparent;">
                ${btnText}
            </button>`;
        }

        // --- HTML ---
        wrapper.innerHTML = `
            <div id="card-${comment.id}" class="card comment-card ${isGoated ? 'is-goated' : ''}" style="margin-bottom:10px; padding:12px; position:relative;">
                
                <div style="display:flex; gap:10px; align-items:start;">
                    <img src="${comment.authorPic || 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png'}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
                    
                    <div style="width:100%;">
                        <div class="goat-badge-container">
                            <svg viewBox="0 0 24 24" fill="currentColor" style="width:12px; height:12px;">
                                <path d="M12,2L14.5,8H19.5L15.5,11L17,16.5L12,13.5L7,16.5L8.5,11L4.5,8H9.5L12,2Z"/> 
                            </svg>
                            <span>GOATED</span>
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center;">
                                <strong style="font-size:13px; cursor:pointer;" onclick="openUserProfile('${comment.authorId}')">${comment.authorName}</strong>
                                ${roleBadge}
                            </div>
                            ${goatBtn}
                        </div>
                        
                        <p style="margin:4px 0; font-size:14px; line-height:1.4; padding-right: 20px;">${comment.text}</p>
                        
                        <div style="display:flex; gap:12px; align-items:center; margin-top:5px;">
                            <button class="btn ${btnClass}" style="padding:2px 8px; font-size:11px; height:auto; min-height:0;" 
                                onclick="handleCommentUpvote(event, '${postData.id}', '${comment.id}')">
                                ↑ ${comment.upvotes || 0}
                            </button>
                            
                            <span style="font-size:11px; color:#aaa; cursor:pointer; font-weight:600;" 
                                onclick="openReplyBox('${postData.id}', '${comment.id}')">Reply</span>

                            ${(currentUser && comment.authorId === currentUser.uid) ? `<span style="font-size:11px; color:#ff453a; cursor:pointer;" onclick="deleteComment('${postData.id}', '${comment.id}')">Delete</span>` : ''}
                            
                            ${comment.children.length > 0 ? `<span style="font-size:11px; color:var(--primary-color); cursor:pointer; margin-left:10px;" onclick="toggleChildren('${comment.id}')">▼ View Replies (${comment.children.length})</span>` : ''}
                        </div>

                        <div id="reply-box-${comment.id}" class="reply-input-container"></div>
                    </div>
                </div>
            </div>
            <div id="children-${comment.id}" class="comment-children"></div>
        `;

        targetContainer.appendChild(wrapper);

        if (comment.children.length > 0) {
            const childContainer = wrapper.querySelector(`#children-${comment.id}`);
            comment.children.forEach(child => createCommentNode(child, childContainer, level + 1));
        }
    }

    // 5. Initial Call: Render roots into the main container
    roots.forEach(root => createCommentNode(root, container, 0));
}
/* --- REPLY LOGIC --- */

// 1. Open/Close the Reply Input Box
function openReplyBox(postId, commentId) {
    const container = document.getElementById(`reply-box-${commentId}`);
    if (!container) return;

    // CHECK VISIBILITY STATE
    // If it has content/is visible, close it.
    if (container.style.display === 'block' && container.innerHTML !== '') {
        container.style.display = 'none';
        container.innerHTML = ''; // Clear content
        return;
    }

    // OPEN IT
    container.style.display = 'block'; // <--- THIS WAS MISSING
    container.innerHTML = `
        <div style="margin-top: 10px; margin-left: 20px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid var(--border-color);">
            <textarea id="reply-input-${commentId}" 
                      placeholder="Write a reply..." 
                      rows="2" 
                      style="width:100%; resize:none; margin-bottom:10px; font-size:14px; background: transparent; color: var(--text-main); border: none; outline: none;"></textarea>
            
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button onclick="openReplyBox('${postId}', '${commentId}')" 
                        class="btn btn-secondary btn-sm" 
                        style="font-size: 11px; padding: 4px 10px;">Cancel</button>
                <button onclick="submitReply('${postId}', '${commentId}')" 
                        class="btn btn-primary btn-sm"
                        style="font-size: 11px; padding: 4px 10px;">Reply</button>
            </div>
        </div>
    `;

    // Auto-focus
    setTimeout(() => {
        const input = document.getElementById(`reply-input-${commentId}`);
        if (input) input.focus();
    }, 50);
}

// 2. Submit the Reply to Firestore
function submitReply(postId, parentId) {
    const input = document.getElementById(`reply-input-${parentId}`);
    const text = input.value.trim();

    if (!text) return;
    if (!currentUser) {
        showToast("Please log in to reply.");
        return;
    }

    const replyData = {
        text: text,
        authorId: currentUser.uid,
        authorName: window.currentUserData.name || "User",
        authorRole: window.currentUserData.role || "Student",
        authorPic: window.currentUserData.profilePic || "",
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        parentId: parentId // <--- CRITICAL: Links this comment to its parent
    };

    // Save to Firestore
    db.collection('posts').doc(postId).collection('comments').add(replyData)
        .then(() => {
            showToast("Reply sent!");
            // Refresh comments to show the new reply
            loadComments(postId);
        })
        .catch(err => {
            console.error("Reply error:", err);
            showToast("Failed to send reply.");
        });
}

function buildCommentNode(c, postId) {
    const isAuthor = currentUser && c.authorId === currentUser.uid;

    // --- VISUAL OVERRIDE FOR COMMENTS ---
    const displayPic = isAuthor && !window.currentUserData.isAnonymousSession ? (window.currentUserData.profilePic || "") : (c.authorPic || "");
    const displayName = isAuthor && !window.currentUserData.isAnonymousSession ? window.currentUserData.name : c.authorName;
    const displayRole = isAuthor && !window.currentUserData.isAnonymousSession ? (window.currentUserData.role || "Student") : (c.authorRole || "Student");
    const displayYear = isAuthor && !window.currentUserData.isAnonymousSession ? (window.currentUserData.year || "") : (c.authorYear || "");
    // ------------------------------------

    const yearBadge = getYearBadgeHtml(displayYear);
    const timeString = timeAgo(c.timestamp);

    let avatarHtml = displayPic
        ? `<img src="${displayPic}"; loading="lazy"; class="post-avatar-small" style="width:30px; height:30px; min-width:30px;">`
        : `<div class="post-avatar-small" style="width:30px; height:30px; min-width:30px; background:#333; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#ccc;">${(displayName || "U").charAt(0)}</div>`;

    const hasChildren = c.children && c.children.length > 0;
    const childHtml = hasChildren
        ? `<div id="children-${c.id}" class="comment-children">${c.children.map(child => buildCommentNode(child, postId)).join('')}</div>`
        : `<div id="children-${c.id}" class="comment-children"></div>`;

    const toggleBtn = hasChildren
        ? `<span style="font-size:11px; color:var(--primary-color); cursor:pointer; margin-left:10px;" onclick="toggleChildren('${c.id}')">▼ View Replies (${c.children.length})</span>`
        : '';

    return `
            <div class="comment-thread-container" id="comment-${c.id}">
                ${hasChildren ? '<div class="comment-thread-line"></div>' : ''}

                <div style="display:flex; gap:10px; padding:10px 0;">
                    ${avatarHtml}
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="color:var(--text-main); font-weight:700; font-size:13px;">${displayName}</span>
                            <span class="badge badge-verified" style="font-size:9px; padding:1px 4px;">${displayRole}</span>
                            ${yearBadge}
                            <span style="color:var(--text-secondary); font-size:11px;">• ${timeString}</span>
                        </div>

                        <div style="color:#ddd; font-size:14px; margin:4px 0 6px 0;">${c.text}</div>

                        <div style="display:flex; gap:12px; align-items:center;">
                            <button class="btn btn-secondary" style="padding:2px 8px; font-size:11px; height:auto; min-height:0;" 
                                onclick="handleCommentUpvote(event, '${postId}', '${c.id}')">↑ ${c.upvotes || 0}</button>
                            
                            <span style="font-size:11px; color:#aaa; cursor:pointer; font-weight:600;" 
                                onclick="showReplyBox('${c.id}')">Reply</span>

                            ${isAuthor ? `<span style="font-size:11px; color:#ff453a; cursor:pointer;" onclick="deleteComment('${postId}', '${c.id}')">Delete</span>` : ''}
                            
                            ${toggleBtn}
                        </div>

                        <div id="reply-box-${c.id}" class="reply-input-container">
                            <form onsubmit="handleNewComment(event, '${c.id}')" style="display:flex; gap:8px;">
                                <input id="reply-input-${c.id}" type="text" placeholder="Reply to ${displayName}..." 
                                    style="padding:8px; font-size:13px; border-radius:15px; border:1px solid #444; background:var(--bg-input); color:white; flex:1;">
                                <button type="submit" class="btn btn-primary" style="padding:5px 12px; font-size:12px;">Post</button>
                            </form>
                        </div>
                    </div>
                </div>
                ${childHtml}
            </div>`;
}

// --- HELPER FUNCTIONS FOR COMMENTS ---
function toggleChildren(commentId) {
    const childContainer = document.getElementById(`children-${commentId}`);
    if (childContainer) {
        childContainer.classList.toggle('open');
    }
}

function showReplyBox(commentId) {
    // Close all other reply boxes first (optional UX choice)
    document.querySelectorAll('.reply-input-container').forEach(el => el.style.display = 'none');

    const box = document.getElementById(`reply-box-${commentId}`);
    if (box) {
        box.style.display = 'block';
        // Focus the input
        setTimeout(() => {
            const input = document.getElementById(`reply-input-${commentId}`);
            if (input) input.focus();
        }, 100);
    }
}

function handleCommentUpvote(event, postId, commentId) {
    event.preventDefault();
    const btn = event.currentTarget;
    const isUpvoted = btn.classList.contains('btn-primary');

    // 1. UI Update
    let rawText = btn.innerText; // e.g. "↑ (5)"
    let count = parseInt(rawText.replace(/\D/g, '')) || 0;

    if (isUpvoted) {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.innerText = `↑ ${Math.max(0, count - 1)}`;
    } else {
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        btn.innerText = `↑ ${count + 1}`;
    }

    // 2. DB Update
    const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    if (isUpvoted) {
        ref.update({
            upvotes: firebase.firestore.FieldValue.increment(-1),
            upvoters: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        });
    } else {
        ref.update({
            upvotes: firebase.firestore.FieldValue.increment(1),
            upvoters: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        }).then(() => {
            // --- NEW: ADD POINT TO AUTHOR ---
            // Fetch comment to get author ID
            ref.get().then(doc => {
                if (doc.exists) updateUserScore(doc.data().authorId, 1); // +1 Point
            });
        });
    }
}

function deleteComment(postId, commentId) {
    showConfirm(
        "Delete Comment?",
        "Are you sure you want to remove this comment?",
        () => {
            db.collection('posts').doc(postId).collection('comments').doc(commentId).delete()
                .then(() => loadComments(postId));
        }
    );
}
/* --- EVENTS TAB LOGIC --- */
/* --- EVENTS FILTER & SORT STATE --- */
window.currentEventFilter = 'all'; // 'all', 'campus', 'outside'
window.currentEventSort = 'soon';  // 'soon', 'late'
window.allEventsCache = []; // Store data here so we don't re-fetch from Firebase on every filter click

/* --- MAIN LOADER --- */
function loadEvents() {
    const listEl = document.getElementById('eventsList');
    if (!listEl) return;

    listEl.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">Fetching latest events...</p>';

    // Fetch from Firebase ONCE
    db.collection('events')
      .get()
      .then(snap => {
          if (snap.empty) {
              listEl.innerHTML = `
                  <div class="empty-state-new" style="margin-top:20px;">
                      <div style="font-size:30px; margin-bottom:10px;">zzz</div>
                      No upcoming events found.
                  </div>`;
              return;
          }

          // 1. Process and Cache Data
          window.allEventsCache = [];
          snap.forEach(doc => {
              const data = doc.data();
              // Try to parse the Date string (e.g., "Oct 24, 2025") into a Timestamp for sorting
              const parsedDate = new Date(data.Date);
              
              window.allEventsCache.push({
                  id: doc.id,
                  ...data,
                  // If parsing fails (invalid date string), treat it as far future (9999) so it sinks to bottom
                  timestamp: isNaN(parsedDate) ? 9999999999999 : parsedDate.getTime()
              });
          });

          // 2. Render based on current filters
          renderEventsList();
      })
      .catch(err => {
          console.error("Error loading events:", err);
          listEl.innerHTML = '<p style="color:var(--danger-color); text-align:center;">Failed to load events.</p>';
      });
}

/* --- RENDERER (Handles Filter/Sort Logic) --- */
function renderEventsList() {
    const listEl = document.getElementById('eventsList');
    let events = [...window.allEventsCache]; // Copy array

    // A. FILTERING
    if (window.currentEventFilter === 'campus') {
        // Filter logic: Check if Location or Title contains keywords
        events = events.filter(e => {
            const loc = (e.Location || "").toLowerCase();
            const src = (e.sourceName || "").toLowerCase();
            return loc.includes('vit') || loc.includes('campus') || loc.includes('vidyalankar') || src.includes('vit');
        });
    } else if (window.currentEventFilter === 'outside') {
        events = events.filter(e => {
            const loc = (e.Location || "").toLowerCase();
            const src = (e.sourceName || "").toLowerCase();
            return !(loc.includes('vit') || loc.includes('campus') || loc.includes('vidyalankar') || src.includes('vit'));
        });
    }

    // B. SORTING
    if (window.currentEventSort === 'soon') {
        events.sort((a, b) => a.timestamp - b.timestamp); // Ascending (Smallest/Soonest timestamp first)
    } else {
        events.sort((a, b) => b.timestamp - a.timestamp); // Descending
    }

    // C. HTML GENERATION
    if (events.length === 0) {
        listEl.innerHTML = '<div class="empty-state-new" style="margin-top:20px;">No events match your filter.</div>';
        return;
    }

    let html = '';
    events.forEach(e => {
        // Safe Link Logic
        let finalLink = e.Link;
        if (!finalLink || !finalLink.startsWith('http')) {
            finalLink = e.sourceUrl || "#";
        }

        // Logo Logic (Fallback to a generic icon if missing)
        const logoImg = e.sourceLogo || "https://cdn-icons-png.flaticon.com/512/1005/1005141.png";

        // Date Badge Color logic
        let dateBadgeColor = "var(--primary-color)";

        html += `
        <div class="card" style="padding:0; overflow:hidden; border:1px solid var(--border-color); display:flex; flex-direction:column;">
            
            <div style="display:flex; padding:15px; gap:15px;">
                <div style="width:60px; height:60px; flex-shrink:0; background:#fff; border-radius:12px; padding:5px; display:flex; align-items:center; justify-content:center;">
                    <img src="${logoImg}" style="width:100%; height:100%; object-fit:contain;">
                </div>

                <div style="flex:1; min-width:0;">
                    <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:5px;">
                        <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">
                            ${e.type || 'EVENT'}
                        </div>
                        <div style="background:rgba(10, 132, 255, 0.1); color:${dateBadgeColor}; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:700;">
                            ${e.Date || 'TBA'}
                        </div>
                    </div>
                    
                    <h3 style="font-size:16px; font-weight:800; margin-bottom:5px; line-height:1.3; color:var(--text-main);">
                        ${e.Title}
                    </h3>
                    
                    <div style="display:flex; align-items:center; gap:5px; font-size:12px; color:#aaa; margin-bottom:8px;">
                        <span>📍</span> ${e.Location || 'Online'}
                    </div>
                </div>
            </div>

            <div style="padding:0 15px 15px 15px;">
                <p style="font-size:13px; color:#ccc; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
                    ${e.Description}
                </p>
            </div>

            <a href="${finalLink}" target="_blank" class="btn btn-primary" 
                style="margin:0 15px 15px 15px; border-radius:12px; text-decoration:none; text-align:center; display:flex; align-items:center; justify-content:center; gap:6px;">
                <span>Register Now</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
            </a>
            
            <div style="background:rgba(255,255,255,0.03); padding:6px 15px; font-size:10px; color:#555; text-align:right;">
                Source: ${e.sourceName || 'V-SYNC Bot'}
            </div>
        </div>`;
    });

    listEl.innerHTML = html;
}

/* --- FILTER MODAL CONTROLS --- */
function openEventFilterModal() {
    document.getElementById('eventFilterModal').classList.add('active');
    updateEventFilterUI();
}

function setEventFilter(type) {
    window.currentEventFilter = type;
    updateEventFilterUI();
}

function setEventSort(type) {
    window.currentEventSort = type;
    updateEventFilterUI();
}

function updateEventFilterUI() {
    // Update Filter Pills
    ['all', 'campus', 'outside'].forEach(t => {
        const el = document.getElementById(`evFilter_${t}`);
        if(el) el.classList.toggle('active', window.currentEventFilter === t);
    });

    // Update Sort Pills
    ['soon', 'late'].forEach(t => {
        const el = document.getElementById(`evSort_${t}`);
        if(el) el.classList.toggle('active', window.currentEventSort === t);
    });
}

function applyEventFilters() {
    closeModal('eventFilterModal');
    renderEventsList(); // Re-render with new settings
}

function upvote(id) { const ref = db.collection('posts').doc(id); ref.get().then(doc => { if (doc.data().authorId === currentUser.uid) return alert("Cannot upvote self"); const upvoters = doc.data().upvoters || []; const hasUpvoted = upvoters.includes(currentUser.uid); ref.update({ upvotes: firebase.firestore.FieldValue.increment(hasUpvoted ? -1 : 1), upvoters: hasUpvoted ? upvoters.filter(x => x !== currentUser.uid) : [...upvoters, currentUser.uid] }).then(loadCommunity); }); }
function upvoteComment(pid, cid) { const ref = db.collection('posts').doc(pid).collection('comments').doc(cid); ref.get().then(doc => { const data = doc.data(); if (data.authorId === currentUser.uid) return; const upvoters = data.upvoters || []; const hasUpvoted = upvoters.includes(currentUser.uid); ref.update({ upvotes: firebase.firestore.FieldValue.increment(hasUpvoted ? -1 : 1), upvoters: hasUpvoted ? upvoters.filter(id => id !== currentUser.uid) : [...upvoters, currentUser.uid] }).then(() => loadComments(pid)); }); }

// --- PROFILE ---
// --- PROFILE ---
function loadProfile() {
    // 1. SAFETY CHECK
    if (!currentUser) return;

    // 2. ANONYMOUS CHECK
    if (window.currentUserData && window.currentUserData.isAnonymousSession) {
        const profileTab = document.getElementById('profile');
        const yearHtml = (typeof getYearBadgeHtml === 'function') ? getYearBadgeHtml(window.currentUserData.realYear) : "";

        profileTab.innerHTML = `
                    <div style="max-width: 500px; margin: 60px auto; text-align: center; padding: 40px; background: var(--bg-card); border-radius: 24px; border: 1px dashed var(--border-color);">
                        <div style="width: 120px; height: 120px; border-radius: 50%; background: #333; color: #666; display: flex; align-items: center; justify-content: center; font-size: 60px; font-weight: bold; border: 4px dashed #555; margin: 0 auto 25px;">?</div>
                        <h1 style="color: var(--text-main); margin-bottom: 10px;">Anonymous</h1>
                        <div style="margin-bottom: 20px;">${yearHtml}</div>
                        <p style="color: var(--text-secondary); margin-bottom: 30px; font-size: 14px; line-height: 1.6;">
                            You are in Anonymous mode.<br>Social features and profile editing are disabled.
                        </p>
                        <div style="display: flex; flex-direction: column; gap: 15px; align-items: center;">
                            <div class="sort-btn-style anon-exit-override" onclick="document.getElementById('exitAnonModal').classList.add('active')" style="background-color: var(--primary-color); box-shadow: 0 8px 50px rgba(10, 132, 255, 0.4);"> 
                                <span class="sort-btn-text" style="margin:0; padding:0 20px;">Exit Anonymous mode</span>
                            </div>
                            <div style="display:flex; gap:10px; margin-top:20px;">
                                <button class="btn btn-secondary" onclick="window.performLogout()">Logout</button>
                                <button class="btn btn-danger" onclick="deleteAccount()">Delete Account</button>
                            </div>
                        </div>
                    </div>`;
        return;
    }

    // 3. STANDARD USER LOGIC
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        const dbData = doc.exists ? doc.data() : {};
        const data = { ...currentUserData, ...dbData };

        const rawName = data.name || "User";
        const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

        // Update Name
        const nameEl = document.getElementById('profileName');
        if (data.role === 'mentor' && data.isVerified) {
            nameEl.innerHTML = `${displayName} <span style="color:#30D158; font-size:0.8em; vertical-align: middle;">✔</span>`;
        } else {
            nameEl.textContent = displayName;
        }

        // Update Badge
        const badgeEl = document.getElementById('profileBadge');
        let badgeText = (data.role || 'student').toUpperCase();
        let badgeColor = 'var(--primary-color)';
        if (data.role === 'mentor') {
            if (data.isVerified) { badgeText = "VERIFIED MENTOR"; badgeColor = "#30D158"; }
            else { badgeText = "MENTOR"; badgeColor = "#636366"; }
        }
        badgeEl.textContent = badgeText;
        badgeEl.style.background = badgeColor;

        // --- FIXED: SIMPLE PROFILE PICTURE ---
        const wrapper = document.querySelector('.profile-pic-wrapper-new');
        if (wrapper) {
            // Remove click events, make it static
            wrapper.onclick = null;

            const picUrl = data.profilePic;
            if (picUrl) {
                wrapper.innerHTML = `<img src="${picUrl}";loading="lazy"; class="profile-pic-large-new">`;
            } else {
                const initial = displayName.charAt(0).toUpperCase();
                wrapper.innerHTML = `<div class="profile-initial-large-new">${initial}</div>`;
            }
        }
        // -------------------------------------

        // Skills
        const skillsContainer = document.getElementById('skillsContainer');
        if (data.skills && data.skills.length > 0) {
            skillsContainer.innerHTML = data.skills.map(skill => `<div class="skill-tag-new">${skill}</div>`).join('');
        } else {
            skillsContainer.innerHTML = '<div class="empty-state-new">No skills added yet. Click Edit Profile to add your expertise.</div>';
        }

        // Info Section
        document.getElementById('profileEmail').textContent = data.email || 'email@example.com';
        document.getElementById('infoCollege').textContent = data.college || 'Not specified';

        const yearContainer = document.getElementById('infoYear');
        yearContainer.innerHTML = '';
        if (data.year && ['FE', 'SE', 'TE', 'BE'].includes(data.year)) {
            if (typeof getYearBadgeHtml === 'function') yearContainer.innerHTML = getYearBadgeHtml(data.year);
            else yearContainer.textContent = data.year;
        } else {
            yearContainer.textContent = data.year || 'Not specified';
        }

        document.getElementById('infoRole').textContent = data.role ? data.role.charAt(0).toUpperCase() + data.role.slice(1) : 'Not specified';

        if (data.joinedDate) {
            const dateObj = data.joinedDate.toDate ? data.joinedDate.toDate() : new Date(data.joinedDate);
            document.getElementById('infoJoined').textContent = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }

        // Populate Edit Form
        document.getElementById('editName').value = data.name || '';
        document.getElementById('editCollege').value = data.college || '';
        document.getElementById('editYear').value = data.year || 'FE';
        document.getElementById('editSkills').value = (data.skills || []).join(', ');

    }).catch(e => {
        console.error("Profile load error:", e);
        document.getElementById('profileName').textContent = 'Error loading profile';
    });

    // Refresh Stats
    if (typeof updateProfileStats === 'function') updateProfileStats();
}
/* --- MARK CHAT AS READ --- */
function markChatAsRead(chatId) {
    if (!currentUser) return;

    // Update the 'lastRead' map in the chat document
    // We use merge: true logic via update
    const updateData = {};
    updateData[`lastRead.${currentUser.uid}`] = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('chats').doc(chatId).update(updateData).catch(err => {
        // If doc doesn't exist or other error (ignore silently)
        console.log("Read receipt update skipped");
    });
}
// --- MISSING FUNCTION FIX ---
function updateProfileStats() {
    if (!currentUser) return;
    const uid = currentUser.uid;

    // 1. Count My Posts
    db.collection('posts').where('authorId', '==', uid).get()
        .then(snap => {
            const el = document.getElementById('statPosts');
            if (el) el.innerText = snap.size;
        })
        .catch(e => console.log("Error counting posts", e));

    // 2. Count Connections (Sent + Received)
    const sentPromise = db.collection('connection_requests').where('senderId', '==', uid).where('status', '==', 'accepted').get();
    const recPromise = db.collection('connection_requests').where('recipientId', '==', uid).where('status', '==', 'accepted').get();

    Promise.all([sentPromise, recPromise])
        .then(([sentSnap, recSnap]) => {
            const total = sentSnap.size + recSnap.size;

            const elConn = document.getElementById('statConnections');
            if (elConn) elConn.innerText = total;

            // For now, we'll set Mentors to 0 or you can implement specific mentor logic here
            const elMentors = document.getElementById('statMentors');
            if (elMentors) elMentors.innerText = 0;
        })
        .catch(e => console.log("Error counting connections", e));
}

// Function to handle the Exit password check
function confirmExitAnon() {
    const inputPass = document.getElementById('exitAnonPassword').value;

    // We retrieve the real password stored in memory during login
    const realPass = window.currentUserData ? window.currentUserData.password : null;

    if (inputPass === realPass) {
        document.getElementById('exitAnonModal').classList.remove('active');
        showToast("🔓 Exiting Anonymous Mode");

        // Reload session as normal user (Pass 'false' for isAnon)
        simulateLogin(window.currentUser.uid, false);
    } else {
        alert("Incorrect Password. Cannot exit Anonymous mode.");
    }
}

function toggleEditMode() {
    const form = document.getElementById('editForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function saveProfile() {
    const name = document.getElementById('editName').value.trim();
    const college = document.getElementById('editCollege').value.trim();
    const year = document.getElementById('editYear').value;
    const skillsInput = document.getElementById('editSkills').value.trim();
    const skills = skillsInput ? skillsInput.split(',').map(s => s.trim()).filter(s => s) : [];

    if (!name) return alert('Please enter your name');

    db.collection('users').doc(currentUser.uid).update({
        name: name,
        college: college,
        year: year,
        skills: skills,
        updatedAt: new Date()
    }).then(() => {
        // --- FIX: Update Global Memory ---
        if (window.currentUserData) {
            window.currentUserData.name = name;
            window.currentUserData.college = college;
            window.currentUserData.year = year;
            window.currentUserData.skills = skills;
        }
        // ---------------------------------

        alert('Profile updated successfully!');
        toggleEditMode();
        loadProfile();
        updateUserInfo();
        syncUserProfileToContent();
    }).catch(error => {
        console.error('Error saving profile:', error);
        alert('Error saving profile: ' + error.message);
    });
}
function adminResetScores() {
    // 1. Security/Confirmation
    const confirmCode = prompt("Type 'RESET' to set ALL mentor scores to 0.");
    if (confirmCode !== 'RESET') return;

    // 2. Perform Batch Update
    const btn = event.target;
    const oldText = btn.innerText;
    btn.innerText = "Resetting...";
    btn.disabled = true;

    db.collection('users').where('role', '==', 'mentor').get()
        .then(snap => {
            const batch = db.batch();
            snap.forEach(doc => {
                batch.update(doc.ref, { score: 0 });
            });
            return batch.commit();
        })
        .then(() => {
            showToast("✅ Leaderboard Reset");
            btn.innerText = oldText;
            btn.disabled = false;
            // Refresh Leaderboard if looking at it
            if (document.getElementById('leaderboard').classList.contains('active')) {
                loadLeaderboard();
            }
        })
        .catch(err => {
            console.error(err);
            alert("Error resetting scores");
            btn.innerText = oldText;
            btn.disabled = false;
        });
}
function triggerHaptic() {

    if (navigator.vibrate) {
        navigator.vibrate(15);
    }
}

function shareProfile() {
    const url = window.location.href;
    if (navigator.share) {
        navigator.share({
            title: document.getElementById('profileName').textContent,
            text: `Check out my profile on V-SYNC`,
            url: url
        });
    } else {
        alert('Profile link: ' + url);
    }
}

function downloadResume() {
    alert('Resume download feature coming soon!');
}

function removeProfilePic() {
    showConfirm(
        "Remove Photo?",
        "Are you sure you want to remove your profile picture?",
        () => {
            db.collection('users').doc(currentUser.uid).update({ profilePic: "" })
                .then(() => {
                    // --- FIX: Clear Global Memory Immediately ---
                    if (window.currentUserData) {
                        window.currentUserData.profilePic = "";
                    }
                    // --------------------------------------------
                    loadProfile();
                    updateUserInfo();
                });
        }
    );
}
function handleFileSelect() { const fileInput = document.getElementById('fileInput'); if (fileInput.files.length > 0) document.getElementById('fileNameDisplay').textContent = fileInput.files[0].name; }
function uploadProfilePic() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput.files.length === 0) return alert("Choose photo first.");

    const file = fileInput.files[0];
    if (file.size > 2 * 1024 * 1024) return alert("File too large (Max 2MB)."); // Increased limit slightly

    const reader = new FileReader();
    reader.onload = function (e) {
        const newPic = e.target.result;

        db.collection('users').doc(currentUser.uid).set({ profilePic: newPic }, { merge: true })
            .then(() => {
                // --- FIX: Update Global Memory Immediately ---
                if (window.currentUserData) {
                    window.currentUserData.profilePic = newPic;
                }
                // ---------------------------------------------

                alert("Updated!");
                loadProfile();
                updateUserInfo();
            })
            .catch(err => console.error(err));
    };
    reader.readAsDataURL(file);
}
// --- UNSEND & CHAT FUNCTIONS ---

// 1. Global listener variable (Only declare this ONCE in your code)
let msgUnsub;

// 2. The Delete Function
function deleteMessage(chatId, messageId) {
    showConfirm(
        "Unsend Message?",
        "This message will be removed for everyone in the chat.",
        () => {
            db.collection('chats').doc(chatId).collection('messages').doc(messageId).delete()
                .then(() => console.log("Message unsent"))
                .catch(error => console.error("Error removing message: ", error));
        }
    );
}

// 3. The Chat Function
// --- 4. OPEN CHAT (With "Last Active" Header) ---
// --- GLOBAL VARS (Add this at the top with others) ---
let chatMetaUnsub;

/* --- OPEN CHAT (With Real-Time Seen Status) --- */
/* --- OPEN CHAT (With Profile Pics) --- */
function openInlineChat(chatId, otherUserId, name) {
    if (window.innerWidth <= 600) lockScroll();

    // 1. Cleanup
    if (msgUnsub) msgUnsub();
    if (chatMetaUnsub) chatMetaUnsub();

    document.getElementById('selectedChatId').value = chatId;

    // 2. UI Setup
    document.getElementById('chats').classList.add('mobile-chat-open');
    if (window.innerWidth <= 600) document.querySelector('.tabs').style.display = 'none';

    const headerInfo = document.getElementById('chatHeaderInfo');
    const initial = name.charAt(0).toUpperCase();

    // --- NEW: Store messages and pic to handle async loading ---
    let currentChatPartnerPic = null;
    let currentMessages = [];
    const cont = document.getElementById('messagesContainer');

    // 3. Fetch User Data (Header + Pic for messages)
    db.collection('users').doc(otherUserId).get().then(doc => {
        let picHtml = `<div style="width:38px; height:38px; border-radius:50%; background:#333; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;">${initial}</div>`;
        let statusText = "Connecting...";
        let statusColor = "var(--text-secondary)";

        if (doc.exists) {
            const u = doc.data();

            // SAVE PIC FOR MESSAGES
            currentChatPartnerPic = u.profilePic;

            if (u.profilePic) picHtml = `<img src="${u.profilePic}" style="width:38px; height:38px; border-radius:50%; object-fit:cover;">`;
            statusText = formatLastActive(u.lastSeen);
            if (statusText === 'Active now') statusColor = '#30D158';

            // Re-render messages now that we have the pic
            if (currentMessages.length > 0) {
                renderMessages(currentMessages, cont, chatId, currentChatPartnerPic);
            }
        }

        headerInfo.innerHTML = `
<div style="display: flex; align-items: center; gap: 12px; cursor: pointer;" onclick="openUserProfile('${otherUserId}')">
    ${picHtml}
    <div style="line-height: 1.3;">
        <div style="font-size: 16px; font-weight: 700; color: var(--text-main);">${name}</div>
        <div style="font-size: 12px; color: ${statusColor};">${statusText}</div>
    </div>
</div>`;
    });

    document.getElementById('sendMessageForm').classList.remove('hidden');
    cont.innerHTML = '';

    markChatAsRead(chatId);

    // 4. MESSAGE LISTENER
    msgUnsub = db.collection('chats').doc(chatId).collection('messages')
        .orderBy('timestamp', 'asc')
        .onSnapshot(snap => {
            if (!snap.empty) markChatAsRead(chatId);

            currentMessages = snap.docs.map(d => ({ ...d.data(), id: d.id }));

            // Pass the pic variable here
            renderMessages(currentMessages, cont, chatId, currentChatPartnerPic);

            cont.scrollTop = cont.scrollHeight;
        });

    // 5. SEEN STATUS LISTENER
    chatMetaUnsub = db.collection('chats').doc(chatId).onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        if (data.lastRead && data.lastRead[otherUserId]) {
            updateSeenStatus(currentMessages, data.lastRead[otherUserId], cont);
        }
    });
}

function removeFromSaved(event, postId) {
    event.stopPropagation();

    // 1. Remove from Database
    db.collection('users').doc(currentUser.uid).update({
        bookmarks: firebase.firestore.FieldValue.arrayRemove(postId)
    }).catch(e => console.error(e));

    // 2. Update Local Data (so the bookmark icon updates elsewhere)
    if (window.currentUserData.bookmarks) {
        window.currentUserData.bookmarks = window.currentUserData.bookmarks.filter(id => id !== postId);
    }

    // 3. Remove the Card from the Modal UI
    const card = event.target.closest('.card');
    if (card) {
        card.style.opacity = '0'; // Fade out
        setTimeout(() => {
            card.remove(); // Remove DOM

            // Check if list is empty
            const list = document.getElementById('savedPostsList');
            if (list && list.children.length === 0) {
                list.innerHTML = `
                    <div class="empty-state-new" style="margin-top:20px;">
                        <div style="font-size:30px; margin-bottom:10px;">🔖</div>
                        You haven't saved any posts yet.
                    </div>`;
            }
        }, 300);
    }

    showToast("Removed from Saved");
}
function renderMessages(messages, container, chatId, otherPic) {
    let html = '';

    // Helper to generate avatar HTML
    const getAvatar = (name) => {
        if (otherPic) return `<img src="${otherPic}" class="chat-msg-avatar">`;
        // Fallback placeholder
        return `<div class="chat-msg-placeholder" style="width:28px; height:28px; font-size:10px;">${name ? name.charAt(0) : '?'}</div>`;
    };

    messages.forEach(m => {
        const me = currentUser ? (m.senderId === currentUser.uid) : false;

        let content;

        // --- 1. DOCUMENT / PDF ---
        if (m.mediaType === 'document') {
            const sizeStr = typeof formatBytes === 'function' ? formatBytes(m.fileSize || 0) : 'File';
            // Use the file icon helper or fallback
            const iconHtml = typeof getFileIcon === 'function' ? getFileIcon(m.fileName || 'file.pdf') : '📄';

            content = `
<div class="file-attachment-card" onclick="forceDownload(event, '${m.imageUrl}', '${m.fileName || 'file'}')" style="border:none; background:rgba(0,0,0,0.2);">
    ${iconHtml}
    <div class="file-info">
        <span class="file-name">${m.fileName || 'Document'}</span>
        <div class="file-meta">${sizeStr} • Tap to Download</div>
    </div>
</div>`;
        }
        // --- 2. IMAGE OR VIDEO ---
        else if (m.imageUrl) {
            content = (m.mediaType === 'video')
                ? `<video src="${m.imageUrl}" controls class="chat-image"></video>`
                : `<img src="${m.imageUrl}" class="chat-image" onclick="openLightbox(this.src)">`;
        }
        // --- 3. TEXT ---
        else {
            content = `<span>${m.text}</span>`;
        }

        const msgIdAttr = `id="msg-${m.id}"`;
        let events = me ? `oncontextmenu="showContextMenu(event, 'message', '${chatId}', '${m.id}')"` : '';

        // Insert Avatar ONLY for 'them'
        const avatarHtml = !me ? getAvatar("User") : '';

        html += `
        <div class="chat-message-row ${me ? 'me' : 'them'}" ${msgIdAttr}>
            ${avatarHtml}
            <div class="msg-bubble ${me ? 'msg-me' : 'msg-them'}" ${events}>
                ${content}
            </div>
        </div>
        <div id="seen-${m.id}" class="seen-placeholder" style="width:100%; display:none;"></div>
        `;
    });
    container.innerHTML = html;
}

// --- HELPER: Update Seen Status Dynamically ---
function updateSeenStatus(messages, otherUserReadTime, container) {
    // 1. Clear all existing "Seen" labels
    container.querySelectorAll('.seen-label').forEach(el => el.remove());

    // 2. Find the LAST message sent by ME
    const myMessages = messages.filter(m => m.senderId === currentUser.uid);
    if (myMessages.length === 0) return;

    const lastMyMsg = myMessages[myMessages.length - 1];

    // 3. Compare Timestamps
    // Ensure both are valid Firestore timestamps or Dates
    const msgTime = lastMyMsg.timestamp ? lastMyMsg.timestamp.toDate() : new Date();
    const readTime = otherUserReadTime ? otherUserReadTime.toDate() : new Date(0); // Default to old if null

    if (readTime >= msgTime) {
        // 4. Inject "Seen" Label
        const msgRow = document.getElementById(`msg-${lastMyMsg.id}`);
        if (msgRow) {
            // Check if label already exists to prevent dupes
            if (!msgRow.nextElementSibling || !msgRow.nextElementSibling.classList.contains('seen-label')) {
                const label = document.createElement('div');
                label.className = 'seen-label';
                label.innerText = 'Seen';
                msgRow.after(label); // Insert after the message row
            }
        }
    }
}
function closeChatView() {
    unlockScroll();
    document.getElementById('chats').classList.remove('mobile-chat-open');

    // SHOW BOTTOM TABS AGAIN
    if (window.innerWidth <= 600) {
        document.querySelector('.tabs').style.display = 'flex';
    }
}
// --- ENABLE ENTER TO SEND (Shift+Enter for New Line) ---
function setupEnterKeySubmits() {

    // Helper to handle the logic
    const addEnterListener = (elementId, actionFunction) => {
        const el = document.getElementById(elementId);
        if (el) {
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault(); // Stop default (New Line)
                    actionFunction(e);  // Trigger Send
                }
            });
        }
    };

    // 1. CHAT MESSAGES
    addEnterListener('messageText', handleSendMessage);

    // 2. COMMENTS
    addEnterListener('commentText', handleNewComment);

    // 3. CREATE POST BODY
    // For the post, we trigger the button click to run validation
    const postBody = document.getElementById('communityPostBody');
    if (postBody) {
        postBody.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('submitPostBtn').click();
            }
        });
    }
}

// --- 1. PRESENCE & TIME UTILS ---

function startPresenceHeartbeat() {
    if (!currentUser) return;
    // Update immediately, then every 2 minutes
    const update = () => db.collection('users').doc(currentUser.uid).update({
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });
    update();
    setInterval(update, 120000);
}

function formatLastActive(timestamp) {
    if (!timestamp) return 'Offline';
    const date = timestamp.toDate();
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 5) return 'Active now';
    if (diffMins < 60) return `Active ${diffMins}m ago`;
    if (diffHours < 24) return `Active ${diffHours}h ago`;
    return `Last seen ${date.toLocaleDateString()}`;
}


/* =========================================
           FIXED COMMENT HANDLER (Saves Profile Data)
           ========================================= */
window.handleNewComment = function (e, parentId = null) {
    e.preventDefault();

    // Determine logic based on if it's a Reply or a Root comment
    let text, inputId;
    if (parentId) {
        // It's a reply
        inputId = `reply-input-${parentId}`;
        text = document.getElementById(inputId).value.trim();
    } else {
        // It's a main comment
        inputId = 'commentText';
        text = document.getElementById(inputId).value.trim();
    }

    if (!text) return;
    if (containsSensitiveContent(text)) {
        logModerationAttempt(text, 'comment'); // Log it
        showToast("⚠️ Comment blocked: Profanity detected.");
        return; // STOP execution
    }

    // Anon Check
    if (window.currentUserData && window.currentUserData.isAnonymousSession) {
        if (typeof showToast === "function") showToast("Restricted: Cannot comment as Anonymous.");
        else alert("Restricted: Cannot comment as Anonymous.");
        return;
    }

    const postId = document.getElementById('currentPostId').value;
    const uData = window.currentUserData;

    // Save to Firestore with parentId field
    db.collection('posts').doc(postId).collection('comments').add({
        text: text,
        authorId: window.currentUser.uid,
        authorName: uData.name,
        authorPic: uData.profilePic || "",
        authorRole: uData.role || "Student",
        authorYear: uData.year || "",
        timestamp: new Date(),
        upvotes: 0,
        upvoters: [],
        parentId: parentId // Null for root, ID for child
    }).then(() => {
        document.getElementById(inputId).value = "";
        if (window.loadComments) window.loadComments(postId);
    }).catch(err => console.error(err));
};
/* --- SCORE HELPER --- */
function updateUserScore(userId, pointsToAdd) {
    if (!userId) return;
    const userRef = db.collection('users').doc(userId);
    userRef.update({
        score: firebase.firestore.FieldValue.increment(pointsToAdd)
    }).catch(err => console.log("Error updating score:", err));
}
function loadLeaderboard() {
    console.log("--- DEBUG LEADERBOARD ---");
    const container = document.getElementById('leaderboard');

    // 1. Ensure the list container exists (Auto-fix HTML)
    let listEl = document.getElementById('leaderboardList');
    if (!listEl) {
        console.log("Rebuilding Leaderboard HTML structure...");
        container.innerHTML = `
            <div class="card" style="margin-bottom: 20px; text-align:center; padding:20px; background: linear-gradient(135deg, #1C1C1E, #2C2C2E);">
                <h2 style="font-size:20px; color:var(--text-main); margin-bottom:5px;">🏆 Top Mentors</h2>
                <p style="font-size:12px; color:var(--text-secondary);">
                    <span style="color:var(--primary-color); font-weight:bold;">+1</span> per Upvote
                </p>
            </div>
            <div id="leaderboardList" class="grid" style="display: flex; flex-direction: column; gap: 10px;"></div>
        `;
        listEl = document.getElementById('leaderboardList');
    }

    listEl.innerHTML = '<p style="text-align:center; color:var(--text-secondary);">Calculating scores...</p>';

    // 2. ADMIN BUTTON INJECTION (Dynamic)
    // First, remove any old buttons to prevent duplicates
    const oldControls = document.getElementById('leaderboardAdminControls');
    if (oldControls) oldControls.remove();

    // Debugging: See exactly who the system thinks you are
    if (currentUser) {
        console.log("My ID:", currentUser.uid);
        console.log("Admin List:", ADMIN_UIDS);
        const isAdmin = ADMIN_UIDS.includes(currentUser.uid);
        console.log("Am I Admin?", isAdmin);

        if (isAdmin) {
            console.log(" injecting Admin Button...");
            const adminDiv = document.createElement('div');
            adminDiv.id = "leaderboardAdminControls";
            adminDiv.style.cssText = "margin-top: 30px; border-top: 1px solid #333; padding-top: 20px; text-align: center;";
            adminDiv.innerHTML = `
                <p style="color: #ff453a; font-size: 10px; margin-bottom: 10px; font-weight: bold;">ADMIN ZONE</p>
                <button class="btn btn-danger" onclick="adminResetScores()" 
                    style="width: 100%; border: 1px dashed #ff453a; background: rgba(255, 69, 58, 0.1); color: #ff453a;">
                    ♻️ Reset All Scores to 0
                </button>
            `;
            // Append to the bottom of the leaderboard tab
            container.appendChild(adminDiv);
        }
    } else {
        console.log("User not logged in yet.");
    }

    // 3. FETCH DATA
    db.collection('users')
        .where('role', '==', 'mentor')
        .orderBy('score', 'desc')
        .limit(50)
        .get()
        .then(snap => {
            if (snap.empty) {
                listEl.innerHTML = '<p style="text-align:center;">No mentors found yet.</p>';
                return;
            }

            let html = '';
            let rank = 1;

            snap.forEach(doc => {
                const u = doc.data();
                const score = u.score || 0;

                let rankClass = 'rank-other';
                if (rank === 1) rankClass = 'rank-1';
                if (rank === 2) rankClass = 'rank-2';
                if (rank === 3) rankClass = 'rank-3';

                const pic = u.profilePic
                    ? `<img src="${u.profilePic}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
                    : u.name.charAt(0).toUpperCase();

                const skillTxt = (u.skills && u.skills.length > 0)
                    ? u.skills.slice(0, 2).join(' • ')
                    : (u.college || 'No info');

                html += `
              <div class="card" style="padding:15px; display:flex; align-items:center; margin-bottom:0;">
                  <div class="rank-badge ${rankClass}">${rank}</div>
                  <div style="flex:1; display:flex; gap:12px; align-items:center;">
                      <div style="width:50px; height:50px; border-radius:50%; background:#222; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:20px; border:1px solid #444; overflow:hidden;">
                          ${pic}
                      </div>
                      <div style="min-width:0;">
                          <div style="font-weight:700; font-size:16px; color:white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                              ${u.name} 
                              ${u.isVerified ? '<span style="color:#30D158;">✔</span>' : ''}
                          </div>
                          <div style="font-size:12px; color:#aaa;">${u.year || ''} • ${skillTxt}</div>
                      </div>
                  </div>
                  <div class="score-display">
                      <span class="score-val">${score}</span>
                      <span class="score-label">Points</span>
                  </div>
              </div>`;
                rank++;
            });

            listEl.innerHTML = html;
        })
        .catch(err => {
            console.error(err);
            listEl.innerHTML = '<p style="color:red; text-align:center;">Error loading leaderboard.</p>';
        });
}

// --- 2. FIX CRASH IN POST MODAL (Safety Checks) ---
// --- 2. FIX CRASH IN POST MODAL (Safety Checks) ---
window.openCreatePostModal = function () {
    lockScroll();
    const modal = document.getElementById('createPostModal');
    if (!modal) return;

    // --- ADD CLOSE BUTTON TO HEADER ---
    const header = modal.querySelector('.modal-header');
    if (header && !header.querySelector('.close-modal-btn')) {
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.innerHTML = `
                    <span>Create Post</span>
                    <span class="close-modal-btn" onclick="closeModal('createPostModal')" style="font-size:24px; cursor:pointer; padding:0 10px;">&times;</span>
                `;
    }
    // ----------------------------------

    modal.classList.add('active');

    // ... (Rest of your existing reset logic: clearing title, body, file, etc.) ...
    const titleEl = document.getElementById('communityPostTitle');
    if (titleEl) titleEl.value = "";
    const bodyEl = document.getElementById('communityPostBody');
    if (bodyEl) bodyEl.value = "";
    const fileEl = document.getElementById('postFileInput');
    if (fileEl) fileEl.value = "";
    const fileNameEl = document.getElementById('postFileName');
    if (fileNameEl) fileNameEl.innerText = "No file";
    const removeBtn = document.getElementById('removePostImgBtn');
    if (removeBtn) removeBtn.style.display = "none";
    const submitBtn = document.getElementById('submitPostBtn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "Post";
    }
};

// --- 3. FIX TAG MENU (Global Scope) ---
window.openTagMenu = function () {
    console.log("Opening Tag Menu...");
    const modal = document.getElementById('tagSelectionModal');
    if (modal) {
        modal.classList.add('active');
        const searchInput = document.getElementById('tagSearchInput');
        if (searchInput) searchInput.value = "";

        // Ensure the render function exists before calling
        if (window.renderTagMenu) window.renderTagMenu();
    } else {
        console.error("Tag Modal missing");
    }
};

// --- 4. RE-INIT ENTER KEY LISTENERS (Safe Version) ---
// --- ENABLE ENTER TO SEND (Shift+Enter for New Line) ---
function setupEnterKeySubmits() {

    // 1. CHAT MESSAGES
    const chatInput = document.getElementById('messageText');
    if (chatInput) {
        const newChatInput = chatInput.cloneNode(true);
        chatInput.parentNode.replaceChild(newChatInput, chatInput);

        newChatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.handleSendMessage(e);
            }
        });
    }

    // 2. COMMENTS (The fix you requested)
    const commentInput = document.getElementById('commentText');
    if (commentInput) {
        // Clone to remove old listeners
        const newCommentInput = commentInput.cloneNode(true);
        commentInput.parentNode.replaceChild(newCommentInput, commentInput);

        newCommentInput.addEventListener('keydown', function (e) {
            // IF Enter is pressed AND Shift is NOT held down
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Stop New Line
                window.handleNewComment(e); // Trigger Submit
            }
            // Else: It does the default (adds a new line)
        });
    }

    // 3. CREATE POST BODY (Trigger Button Click)
    const postBody = document.getElementById('communityPostBody');
    if (postBody) {
        const newPostBody = postBody.cloneNode(true);
        postBody.parentNode.replaceChild(newPostBody, postBody);

        newPostBody.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('submitPostBtn').click();
            }
        });
    }
}

// Run setup immediately
setupEnterKeySubmits();
/* =========================================
ROBUST TAG SYSTEM (Global Scope Fix)
========================================= */

// 1. Initialize Global Variables
window.selectedTags = window.selectedTags || [];



// 3. Global Open/Close Functions
window.openTagMenu = function () {
    console.log("Opening Tag Menu...");
    const modal = document.getElementById('tagSelectionModal');
    if (modal) {
        modal.classList.add('active');
        // Clear search
        const searchInput = document.getElementById('tagSearchInput');
        if (searchInput) searchInput.value = "";

        // Render
        window.renderTagMenu();
    } else {
        alert("Error: ID 'tagSelectionModal' not found in HTML.");
    }
};

window.closeTagMenu = function () {
    document.getElementById('tagSelectionModal').classList.remove('active');
    window.renderTagsOnMainForm();
};

window.filterTags = function () {
    window.renderTagMenu();
};

// 4. Main Render Function (With Error Catching)
window.renderTagMenu = function () {
    const list = document.getElementById('tagListArea');
    const searchInput = document.getElementById('tagSearchInput');

    if (!list) return;

    const search = searchInput ? searchInput.value.toLowerCase().trim() : "";
    let html = '';

    TAG_DATA.forEach(tag => {
        if (search && !tag.name.toLowerCase().includes(search)) return;

        const isSelected = window.selectedTags.some(t => t.text === tag.name);
        const activeClass = isSelected ? 'selected' : '';
        const checkIcon = isSelected ? '<span style="color:#30D158; font-weight:bold; font-size:16px;">✔</span>' : '';
        const hasSub = tag.hasSub ? 'true' : 'false';

        // Render Main Tag Row
        html += `
            <div>
                <div class="tag-menu-item ${activeClass}" 
                     onclick="window.toggleMainTag('${tag.name}', '${tag.class}', '${tag.hex}', ${hasSub})">
                    <div style="display:flex; align-items:center;">
                        <div class="tag-dot" style="background:${tag.hex};"></div>
                        <span style="font-weight:600; font-size:15px; color:white;">${tag.name}</span>
                    </div>
                    ${checkIcon}
                </div>`;

        // --- CHANGED LOGIC HERE ---
        // Check if ANY sub-tag is currently selected
        const isChildSelected = tag.hasSub && window.selectedTags.some(t => COUNCIL_SUBS.includes(t.text));

        // Show sub-menu if Parent is selected OR a Child is selected
        if (tag.hasSub && (isSelected || isChildSelected)) {
            html += `<div class="sub-tag-container">`;
            COUNCIL_SUBS.forEach(sub => {
                const isSubSelected = window.selectedTags.some(t => t.text === sub);
                const subActive = isSubSelected ? 'selected' : '';
                const subIcon = isSubSelected ? '●' : '○';

                html += `
                    <div class="sub-tag-item ${subActive}" onclick="window.toggleSubTag('${sub}')">
                        <span style="margin-right:10px; font-size:12px;">${subIcon}</span> ${sub}
                    </div>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
    });

    if (html === '') html = `<div style="text-align:center; padding:20px; color:#888;">No tags found.</div>`;
    list.innerHTML = html;
};
function forceDownload(e, url, fileName) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    if (typeof showToast === 'function') showToast("Downloading...");

    // Try fetching the blob (Works if CORS is fixed)
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';

    xhr.onload = function () {
        if (xhr.status === 200) {
            const blob = xhr.response;
            const blobUrl = window.URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
        } else {
            // Fallback if CORS blocks it
            window.open(url, '_blank');
        }
    };

    xhr.onerror = function () {
        // Network error / CORS blocked -> Fallback to opening tab
        console.warn("CORS blocked internal download. Opening in new tab.");
        window.open(url, '_blank');
    };

    xhr.send();
}

// 5. Toggle Logic (Global)
window.toggleMainTag = function (name, className, hex, hasSub) {
    if (!window.selectedTags) window.selectedTags = [];

    const index = window.selectedTags.findIndex(t => t.text === name);

    if (index > -1) {
        // Remove tag
        window.selectedTags.splice(index, 1);
        // If parent removed, remove its children
        if (hasSub) {
            window.selectedTags = window.selectedTags.filter(t => !COUNCIL_SUBS.includes(t.text));
        }
    } else {
        // Add tag
        if (window.selectedTags.length >= 2) return alert("Maximum 2 tags allowed.");
        window.selectedTags.push({ text: name, colorClass: className, hex: hex });
    }
    window.renderTagMenu();
};

window.toggleSubTag = function (subName) {
    const index = window.selectedTags.findIndex(t => t.text === subName);

    if (index > -1) {
        // If clicking an existing sub-tag, remove it
        window.selectedTags.splice(index, 1);
    } else {
        // If adding a sub-tag...
        // 1. Check limit. We allow if "Council" is currently selected (because we will swap it)
        const councilIndex = window.selectedTags.findIndex(t => t.text === "Council / Committee");
        const currentCount = window.selectedTags.length;

        // If at limit (2) and Council isn't one of them, stop.
        if (currentCount >= 2 && councilIndex === -1) {
            return alert("Maximum 2 tags allowed.");
        }

        // 2. Remove the generic "Council" tag if it exists (Swap Parent for Child)
        if (councilIndex > -1) {
            window.selectedTags.splice(councilIndex, 1);
        }

        // 3. Add the specific sub-tag
        window.selectedTags.push({ text: subName, colorClass: 'tag-sub-council', hex: '#24A0ED' });
    }
    window.renderTagMenu();
    window.renderTagsOnMainForm();
};

// 6. Main Form Pill Renderer
window.renderTagsOnMainForm = function () {
    const container = document.getElementById('selectedTagsContainer');
    if (!container) return;

    if (!window.selectedTags || window.selectedTags.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = window.selectedTags.map((tag, i) => `
        <div style="background:${tag.hex || '#555'}; display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 12px; margin-right: 5px; font-size: 12px; font-weight: 600; color: white;">
            ${tag.text}
            <span style="margin-left: 8px; cursor: pointer; opacity: 0.7;" onclick="window.removeTag(${i})">✕</span>
        </div>
    `).join('');
};

window.removeTag = function (index) {
    window.selectedTags.splice(index, 1);
    window.renderTagsOnMainForm();
};
// --- TIME AGO HELPER (Instagram Style) ---
function timeAgo(dateInput) {
    if (!dateInput) return 'Just now';

    // Handle Firestore Timestamp or standard Date object
    const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return interval + "y ago";

    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + "mo ago";

    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + "d ago";

    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + "h ago";

    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + "m ago";

    return "Just now";
}
function validateRoleOptions() {
    const yearSelect = document.getElementById('regYear');
    const roleSelect = document.getElementById('regRole');

    if (!yearSelect || !roleSelect) return;

    const selectedYear = yearSelect.value;
    const mentorOption = roleSelect.querySelector('option[value="mentor"]');

    // Logic: If FE is selected, Disable Mentor
    if (selectedYear === 'FE') {
        mentorOption.disabled = true;
        mentorOption.innerText = "Mentor (Available for SE+)"; // Helpful text

        // If they had already selected Mentor, force them back to Student
        if (roleSelect.value === 'mentor') {
            roleSelect.value = 'student';
            // Optional: Alert the user
            if (typeof showToast === 'function') showToast("Mentorship is available from Second Year onwards.");
            else alert("First Year students cannot be mentors yet.");
        }
    } else {
        // Re-enable for SE, TE, BE
        mentorOption.disabled = false;
        mentorOption.innerText = "Mentor";
    }
}
function getYearBadgeHtml(yearCode) {
    if (!yearCode) return '';

    let color = '#888'; // Default Grey
    let label = yearCode;

    switch (yearCode) {
        case 'FE': color = '#30D158'; label = 'FE'; break; // Green
        case 'SE': color = '#0A84FF'; label = 'SE'; break; // Blue
        case 'TE': color = '#BF5AF2'; label = 'TE'; break; // Purple
        case 'BE': color = '#FF9F0A'; label = 'BE'; break; // Orange
    }

    return `<span style="
        background-color: ${color}20; 
        color: ${color}; 
        border: 1px solid ${color}40;
        padding: 2px 6px; 
        border-radius: 4px; 
        font-size: 10px; 
        font-weight: 800; 
        margin-left: 6px;
        vertical-align: middle;
    ">${label}</span>`;
}

// --- CLOSE MODALS ON OUTSIDE CLICK (Animated) ---
window.addEventListener('mousedown', function (e) {
    // Check if the click target is the backdrop itself (has class 'modal')
    if (e.target.classList.contains('modal')) {
        // Use the ID of the modal to trigger the smooth close function
        closeModal(e.target.id);
    }
});
/* --- V-SYNC SPLASH LOGIC --- */
window.addEventListener('load', () => {
    // 2.2 seconds provides enough time for the intro animation to "breath"
    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash) {
            splash.classList.add('fade-out');

            // Remove from DOM after fade finishes
            setTimeout(() => {
                splash.remove();
            }, 600);
        }
    }, 2200);
});
function toggleGoatStatus(postId, commentId, authorRole) {
    // 1. STRICT SECURITY CHECK: Only Mentors
    if (!authorRole || authorRole.toLowerCase() !== 'mentor') {
        showToast("🚫 Only Mentors can be GOATed!");
        return;
    }

    const card = document.getElementById(`card-${commentId}`);
    if (!card) return;

    const btn = card.querySelector('button[onclick*="toggleGoatStatus"]');

    // 2. Optimistic Update (Visuals)
    const isCurrentlyGoated = card.classList.contains('is-goated');

    // Reset ALL cards first (Single Winner logic)
    document.querySelectorAll('.comment-card.is-goated').forEach(c => {
        c.classList.remove('is-goated');
        const otherBtn = c.querySelector('button[onclick*="toggleGoatStatus"]');
        if (otherBtn) otherBtn.innerHTML = '🏆 Mark GOAT';
    });

    if (!isCurrentlyGoated) {
        // TURN ON
        card.classList.add('is-goated');
        if (btn) btn.innerHTML = 'Un-Goat';
        if (navigator.vibrate) navigator.vibrate(50);
    } else {
        // TURN OFF (Un-Goat)
        card.classList.remove('is-goated');
        if (btn) btn.innerHTML = '🏆 Mark GOAT';
    }

    // 3. Database Update with Score Logic
    const postRef = db.collection('posts').doc(postId);

    db.runTransaction(async (transaction) => {
        const postDoc = await transaction.get(postRef);
        if (!postDoc.exists) return;

        const currentGoatId = postDoc.data().goatedCommentId;

        if (currentGoatId === commentId) {
            // UN-GOAT: Remove status
            transaction.update(postRef, { goatedCommentId: firebase.firestore.FieldValue.delete() });
            return { action: 'remove', targetId: commentId };
        } else {
            // GOAT: Set status (and return old ID if we are switching)
            transaction.update(postRef, { goatedCommentId: commentId });
            return { action: 'add', targetId: commentId, oldId: currentGoatId };
        }
    }).then((res) => {
        if (!res) return;

        // --- HELPER TO ADJUST SCORE ---
        const adjustScore = (cId, points) => {
            db.collection('posts').doc(postId).collection('comments').doc(cId).get()
                .then(doc => {
                    if (doc.exists) updateUserScore(doc.data().authorId, points);
                });
        };

        if (res.action === 'add') {
            showToast("🏆 Answer marked as GOATED!");
            // 1. Give points to the NEW Goat
            adjustScore(res.targetId, 5);

            // 2. Remove points from the OLD Goat (if we switched winners)
            if (res.oldId) {
                adjustScore(res.oldId, -5);
            }
        } else if (res.action === 'remove') {
            showToast("Tag removed. Points deducted.");
            // 3. Remove points from the Un-Goated user
            adjustScore(res.targetId, -5);
        }

    }).catch(error => {
        console.error("Goat error:", error);
        // Revert UI on failure
        if (isCurrentlyGoated) {
            card.classList.add('is-goated');
            if (btn) btn.innerHTML = 'Un-Goat';
        } else {
            card.classList.remove('is-goated');
            if (btn) btn.innerHTML = '🏆 Mark GOAT';
        }
        showToast("Action failed.");
    });
}
