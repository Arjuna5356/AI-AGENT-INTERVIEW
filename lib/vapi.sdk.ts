import Vapi from "@vapi-ai/web";
import DailyIframe from "@daily-co/daily-js";

type PatchedDaily = {
  __vapiAudioPatched?: boolean;
  createCallObject: (...args: unknown[]) => {
    updateInputSettings?: (inputSettings: unknown) => unknown;
  };
};

type InputSettingsWithAudio = {
  audio?: {
    processor?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const patchDailyUnsupportedAudioProcessor = () => {
  const daily = DailyIframe as unknown as PatchedDaily;

  if (daily.__vapiAudioPatched) return;

  const originalCreateCallObject = daily.createCallObject.bind(DailyIframe);

  daily.createCallObject = (...args: unknown[]) => {
    const callObject = originalCreateCallObject(...args);

    if (!callObject || typeof callObject.updateInputSettings !== "function") {
      return callObject;
    }

    const originalUpdateInputSettings =
      callObject.updateInputSettings.bind(callObject);

    callObject.updateInputSettings = (inputSettings: unknown) => {
      if (
        !inputSettings ||
        typeof inputSettings !== "object" ||
        !("audio" in inputSettings)
      ) {
        return originalUpdateInputSettings(inputSettings);
      }

      const typedInputSettings = inputSettings as InputSettingsWithAudio;
      const audioSettings = typedInputSettings.audio;

      if (!audioSettings || typeof audioSettings !== "object") {
        return originalUpdateInputSettings(inputSettings);
      }

      if (!("processor" in audioSettings)) {
        return originalUpdateInputSettings(inputSettings);
      }

      const { processor: _ignoredProcessor, ...audioWithoutProcessor } =
        audioSettings;

      return originalUpdateInputSettings({
        ...typedInputSettings,
        audio: audioWithoutProcessor,
      });
    };

    return callObject;
  };

  daily.__vapiAudioPatched = true;
};

patchDailyUnsupportedAudioProcessor();

export const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN!);
