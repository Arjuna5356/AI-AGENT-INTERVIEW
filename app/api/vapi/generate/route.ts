import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

import { getFirebaseAdmin } from "@/firebase/admin";
import { getRandomInterviewCover } from "@/lib/utils";

export const dynamic = "force-dynamic";

const generateInterviewSchema = z.object({
  type: z.enum(["behavioural", "technical", "mixed"]),
  role: z.string().trim().min(2).max(120),
  level: z.string().trim().min(2).max(80),
  techstack: z.string().trim().min(2).max(1000),
  amount: z.coerce.number().int().min(1).max(20),
  userid: z
    .string()
    .trim()
    .min(6)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const parseSessionCookie = (cookieHeader: string | null) => {
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith("session="));

  if (!cookie) return null;
  return cookie.slice("session=".length);
};

const parseQuestions = (questions: string) => {
  const parsed = JSON.parse(questions) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Model response is not a valid string array");
  }

  return parsed;
};

export async function POST(request: Request) {
  try {
    const { auth, db } = getFirebaseAdmin();
    const body = await request.json();
    const parsedBody = generateInterviewSchema.safeParse(body);

    if (!parsedBody.success) {
      return Response.json(
        { success: false, error: "Invalid request payload." },
        { status: 400 }
      );
    }

    const { type, role, level, techstack, amount, userid } = parsedBody.data;

    const sessionCookie = parseSessionCookie(request.headers.get("cookie"));
    let decodedClaims: Awaited<ReturnType<typeof auth.verifySessionCookie>> | null =
      null;

    if (sessionCookie) {
      try {
        decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
      } catch {
        return Response.json(
          { success: false, error: "Invalid session." },
          { status: 401 }
        );
      }
    }

    if (decodedClaims?.uid && decodedClaims.uid !== userid) {
      return Response.json(
        { success: false, error: "Invalid user identity." },
        { status: 403 }
      );
    }

    const effectiveUserId = decodedClaims?.uid ?? userid;
    const userDoc = await db.collection("users").doc(effectiveUserId).get();

    if (!userDoc.exists) {
      return Response.json(
        { success: false, error: "User not found." },
        { status: 404 }
      );
    }

    const { text: questions } = await generateText({
      model: google("gemini-2.0-flash-001"),
      prompt: `Prepare questions for a job interview.
        The job role is ${role}.
        The job experience level is ${level}.
        The tech stack used in the job is: ${techstack}.
        The focus between behavioural and technical questions should lean towards: ${type}.
        The amount of questions required is: ${amount}.
        Please return only the questions, without any additional text.
        The questions are going to be read by a voice assistant so do not use "/" or "*" or any other special characters which might break the voice assistant.
        Return the questions formatted like this:
        ["Question 1", "Question 2", "Question 3"]
        
        Thank you! <3
    `,
    });

    const parsedQuestions = parseQuestions(questions);

    const interview = {
      role,
      type,
      level,
      techstack: techstack
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      questions: parsedQuestions,
      userId: effectiveUserId,
      finalized: true,
      coverImage: getRandomInterviewCover(),
      createdAt: new Date().toISOString(),
    };

    await db.collection("interviews").add(interview);

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate interview.";

    return Response.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({ success: true, data: "Thank you!" }, { status: 200 });
}
