// iOS Canlı Etkinlik (K-59): kilit ekranı afişi ve Dynamic Island. Yalnızca iOS 16.2+; diğer
// platformlarda `lib/liveTrip.ts` bu fabrikayı çağırmaz.
// Renkler kök DESIGN.md tokenlarıyla aynıdır (widget ayrı derlendiği için tokens.ts içe aktarılmaz; __tests__/tokens.test.ts denetler).
import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, monospacedDigit, padding, tint } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import type { LiveTripProps } from "./types";

const TripActivity = (props: LiveTripProps, environment: LiveActivityEnvironment) => {
  "widget";
  // Renkler fonksiyon içinde: widget çalışma zamanı modül düzeyi sabitleri görmez.
  const gold = environment.isLuminanceReduced ? "#FFFFFF" : "#a8875a";
  const green = "#18794e";
  const icon = props.role === "driver" ? "steeringwheel" : "car.fill";
  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 })]}>
        <HStack spacing={8}>
          <Image systemName={icon} color={gold} />
          <Text modifiers={[font({ weight: "semibold", size: 16 })]}>{props.title}</Text>
          <Spacer />
          <Text modifiers={[font({ weight: "bold", size: 16 }), monospacedDigit()]}>{props.eta}</Text>
        </HStack>
        <ProgressView value={props.progress} modifiers={[tint(green)]} />
        <HStack spacing={6}>
          <Text modifiers={[font({ size: 13 }), foregroundStyle("#8A8A8A")]}>{props.detail}</Text>
          <Spacer />
          <Text modifiers={[font({ weight: "semibold", size: 11 }), foregroundStyle(gold)]}>GETAWAY</Text>
        </HStack>
      </VStack>
    ),
    compactLeading: <Image systemName={icon} color={gold} />,
    compactTrailing: (
      <Text modifiers={[font({ weight: "semibold", size: 14 }), monospacedDigit()]}>{props.eta}</Text>
    ),
    minimal: <Image systemName={icon} color={gold} />,
    expandedLeading: (
      <VStack modifiers={[padding({ leading: 8, top: 8 })]}>
        <Image systemName={icon} color={gold} />
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ trailing: 8, top: 8 })]}>
        <Text modifiers={[font({ weight: "bold", size: 18 }), monospacedDigit()]}>{props.eta}</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ horizontal: 12, bottom: 8 })]}>
        <Text modifiers={[font({ weight: "semibold", size: 15 })]}>{props.title}</Text>
        <ProgressView value={props.progress} modifiers={[tint(green)]} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle("#8A8A8A")]}>{props.detail}</Text>
      </VStack>
    ),
  };
};

export default createLiveActivity<LiveTripProps>("TripActivity", TripActivity);
