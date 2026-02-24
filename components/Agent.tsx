"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AssistantOverrides, WorkflowOverrides } from "@vapi-ai/web/dist/api";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { generator, interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

const CALL_START_TIMEOUT_MS = 25000;

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const getVapiErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    (error as { error?: unknown }).error
  ) {
    const nested = (error as { error?: { message?: unknown; error?: unknown } })
      .error;

    if (nested && typeof nested === "object") {
      const nestedMessage = (nested as { message?: unknown }).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
        return nestedMessage;
      }

      if (Array.isArray(nestedMessage) && nestedMessage.length > 0) {
        const joined = nestedMessage
          .map((item) => (typeof item === "string" ? item : ""))
          .filter(Boolean)
          .join(", ");

        if (joined.length > 0) return joined;
      }

      const nestedError = (nested as { error?: unknown }).error;
      if (typeof nestedError === "string" && nestedError.trim().length > 0) {
        return nestedError;
      }
    }
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  if (
    error &&
    typeof error === "object" &&
    "errorMsg" in error &&
    typeof (error as { errorMsg?: unknown }).errorMsg === "string"
  ) {
    return (error as { errorMsg: string }).errorMsg;
  }

  return "Unknown call error";
};

const isIgnorableVapiError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("meeting has ended") ||
    normalized.includes("unsupported input processor") ||
    normalized.includes("audio-processor-error")
  );
};

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");

  useEffect(() => {
    const onCallStart = () => {
      setCallStatus(CallStatus.ACTIVE);
    };

    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);
    };

    const onCallStartFailed = (event: unknown) => {
      const message = getVapiErrorMessage(event);
      console.error("Vapi call start failed:", event);
      toast.error(message);
      setCallStatus(CallStatus.INACTIVE);
    };

    const onMessage = (message: Message) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }
    };

    const onSpeechStart = () => {
      console.log("speech start");
      setIsSpeaking(true);
    };

    const onSpeechEnd = () => {
      console.log("speech end");
      setIsSpeaking(false);
    };

    const onError = (error: unknown) => {
      const message = getVapiErrorMessage(error);
      if (isIgnorableVapiError(message)) return;

      console.error("Vapi call error:", error);
      toast.error(message);
      setCallStatus(CallStatus.INACTIVE);
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("call-start-failed", onCallStartFailed);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("call-start-failed", onCallStartFailed);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setLastMessage(messages[messages.length - 1].content);
    }

    const handleGenerateFeedback = async (messages: SavedMessage[]) => {
      console.log("handleGenerateFeedback");

      const { success, feedbackId: id } = await createFeedback({
        interviewId: interviewId!,
        userId: userId!,
        transcript: messages,
        feedbackId,
      });

      if (success && id) {
        router.push(`/interview/${interviewId}/feedback`);
      } else {
        console.log("Error saving feedback");
        router.push("/");
      }
    };

    if (callStatus === CallStatus.FINISHED) {
      if (type === "generate") {
        router.push("/");
      } else {
        handleGenerateFeedback(messages);
      }
    }
  }, [messages, callStatus, feedbackId, interviewId, router, type, userId]);

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);

    try {
      if (type === "generate") {
        if (!userId) {
          toast.error("Please sign in again and try one more time.");
          setCallStatus(CallStatus.INACTIVE);
          return;
        }

        const workflowOverrides: WorkflowOverrides = {
          variableValues: {
            username: userName,
            userid: userId,
          },
        };

        const assistantOverrides: AssistantOverrides = {
          variableValues: {
            username: userName,
            userid: userId,
          },
        };

        const configuredWorkflowId = process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID;
        const configuredAssistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
        let fallbackAssistantId = configuredAssistantId;

        let call: Awaited<ReturnType<typeof vapi.start>> | undefined =
          undefined;

        if (configuredWorkflowId) {
          try {
            call = await withTimeout(
              vapi.start(
                undefined,
                undefined,
                undefined,
                configuredWorkflowId,
                workflowOverrides
              ),
              CALL_START_TIMEOUT_MS,
              "Call setup timed out. Please verify your Vapi workflow ID and try again."
            );
          } catch (error) {
            console.warn("Configured workflow ID failed, trying fallback.", error);
            const workflowErrorMessage = getVapiErrorMessage(error).toLowerCase();
            if (
              !fallbackAssistantId &&
              workflowErrorMessage.includes("couldn't get workflow")
            ) {
              // Common misconfiguration: assistant ID entered in workflow env var.
              fallbackAssistantId = configuredWorkflowId;
            }
            call = undefined;
          }
        }

        if (!call && fallbackAssistantId) {
          try {
            call = await withTimeout(
              vapi.start(fallbackAssistantId, assistantOverrides),
              CALL_START_TIMEOUT_MS,
              "Call setup timed out. Please verify your Vapi assistant ID and try again."
            );
          } catch (error) {
            console.warn("Configured assistant ID failed, trying fallback.", error);
            call = undefined;
          }
        }

        if (!call) {
          call = await withTimeout(
            vapi.start(
              undefined,
              undefined,
              undefined,
              generator,
              workflowOverrides
            ),
            CALL_START_TIMEOUT_MS,
            "Call setup timed out. Please verify your Vapi configuration and try again."
          );
        }

        if (!call) {
          setCallStatus(CallStatus.INACTIVE);
          return;
        }

        // Trigger the first model response explicitly for workflow calls.
        vapi.send({ type: "control", control: "say-first-message" });
      } else {
        let formattedQuestions = "";
        if (questions) {
          formattedQuestions = questions
            .map((question) => `- ${question}`)
            .join("\n");
        }

        const assistantOverrides: AssistantOverrides = {
          variableValues: {
            questions: formattedQuestions,
          },
        };

        const configuredAssistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
        let call: Awaited<ReturnType<typeof vapi.start>> | undefined;

        if (configuredAssistantId) {
          try {
            call = await withTimeout(
              vapi.start(configuredAssistantId, assistantOverrides),
              CALL_START_TIMEOUT_MS,
              "Call setup timed out. Please verify your Vapi assistant ID and try again."
            );
          } catch (error) {
            console.warn("Configured assistant ID failed, trying fallback.", error);
          }
        }

        if (!call) {
          call = await withTimeout(
            vapi.start(interviewer, assistantOverrides),
            CALL_START_TIMEOUT_MS,
            "Call setup timed out. Please verify your Vapi configuration and try again."
          );
        }

        if (!call) {
          setCallStatus(CallStatus.INACTIVE);
          return;
        }
      }
    } catch (error: unknown) {
      const errorMessage = getVapiErrorMessage(error);
      console.error("Failed to start Vapi call:", error);
      toast.error(errorMessage);
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    vapi.stop();
  };

  return (
    <>
      <div className="call-view">
        {/* AI Interviewer Card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User Profile Card */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== "ACTIVE" ? (
          <button className="relative btn-call" onClick={() => handleCall()}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />

            <span className="relative">
              {callStatus === "INACTIVE" || callStatus === "FINISHED"
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={() => handleDisconnect()}>
            End
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;
