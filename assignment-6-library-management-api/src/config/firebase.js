const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");
const fs = require("fs");

let serviceAccount;

// 1. Check environment variables (raw JSON or base64)
const rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_CONFIG || process.env.FIREBASE_CREDENTIALS;
if (rawEnv) {
    try {
        serviceAccount = typeof rawEnv === "string" ? JSON.parse(rawEnv) : rawEnv;
    } catch (err) {
        try {
            const decoded = Buffer.from(rawEnv, "base64").toString("utf-8");
            serviceAccount = JSON.parse(decoded);
        } catch (e) {
            console.error("Failed to parse FIREBASE environment variable:", err.message);
        }
    }
}

// 2. Check secret file paths (Render Secret Files, cwd, etc.)
if (!serviceAccount) {
    const searchDirs = [
        "/etc/secrets",
        process.cwd(),
        path.join(__dirname, "../.."),
        path.join(__dirname, ".."),
        __dirname
    ];

    // Helper to check if a json file is a firebase service account
    const tryLoadKey = (filePath) => {
        try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                if (content && (content.type === "service_account" || content.project_id || content.private_key)) {
                    return content;
                }
            }
        } catch (err) {
            // Ignore non-matching or unreadable files
        }
        return null;
    };

    // First check explicit GOOGLE_APPLICATION_CREDENTIALS
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        serviceAccount = tryLoadKey(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }

    // Next scan directories for any matching JSON file
    if (!serviceAccount) {
        for (const dir of searchDirs) {
            try {
                if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        if (file.endsWith(".json") && !file.includes("package")) {
                            const found = tryLoadKey(path.join(dir, file));
                            if (found) {
                                console.log(`[Firebase] Loaded credentials from: ${path.join(dir, file)}`);
                                serviceAccount = found;
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                // Directory not accessible
            }
            if (serviceAccount) break;
        }
    }
}

if (serviceAccount && getApps().length === 0) {
    initializeApp({
        credential: cert(serviceAccount)
    });
} else if (getApps().length === 0) {
    try {
        initializeApp();
    } catch (e) {
        console.warn("Firebase initialized without explicit credentials:", e.message);
    }
}

let dbInstance = null;
try {
    if (getApps().length > 0) {
        dbInstance = getFirestore();
    }
} catch (e) {
    console.error("Error obtaining Firestore instance:", e.message);
}

// Safe wrapper so app does not crash immediately upon require if credentials are missing
const db = dbInstance || {
    collection: (name) => {
        console.error(`[Firebase] Cannot access collection '${name}' because Firebase credentials are not configured.`);
        return {
            add: async () => { throw new Error("Firebase credentials missing"); },
            doc: () => ({
                get: async () => ({ exists: false, data: () => ({}) }),
                update: async () => {},
                delete: async () => {}
            }),
            where: () => ({
                limit: () => ({
                    get: async () => ({ empty: true, docs: [] })
                })
            }),
            get: async () => ({ docs: [] })
        };
    }
};

module.exports = {
    db
};