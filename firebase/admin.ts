import { cert, getApps, initializeApp } from "firebase-admin/app";
import type { ServiceAccount } from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type FirebaseAdminServices = {
  auth: ReturnType<typeof getAuth>;
  db: ReturnType<typeof getFirestore>;
};

const normalizePrivateKey = (privateKey: string) =>
  privateKey.replace(/\\n/g, "\n");

const fromServiceAccountJson = (): ServiceAccount | null => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY must be valid JSON for a Firebase service account."
    );
  }

  const projectId = (parsed.project_id ?? parsed.projectId) as
    | string
    | undefined;
  const clientEmail = (parsed.client_email ?? parsed.clientEmail) as
    | string
    | undefined;
  const privateKey = (parsed.private_key ?? parsed.privateKey) as
    | string
    | undefined;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is missing project_id, client_email, or private_key."
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
};

const fromSplitEnv = (): ServiceAccount => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const missing = [
    !projectId ? "FIREBASE_PROJECT_ID" : null,
    !clientEmail ? "FIREBASE_CLIENT_EMAIL" : null,
    !privateKey ? "FIREBASE_PRIVATE_KEY" : null,
  ].filter(Boolean) as string[];

  if (missing.length) {
    throw new Error(
      `Missing Firebase Admin environment variables: ${missing.join(", ")}.`
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
};

const getServiceAccount = (): ServiceAccount =>
  fromServiceAccountJson() ?? fromSplitEnv();

let cachedServices: FirebaseAdminServices | null = null;

export function getFirebaseAdmin(): FirebaseAdminServices {
  if (cachedServices) return cachedServices;

  if (!getApps().length) {
    initializeApp({
      credential: cert(getServiceAccount()),
    });
  }

  cachedServices = {
    auth: getAuth(),
    db: getFirestore(),
  };

  return cachedServices;
}
