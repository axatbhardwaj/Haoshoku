import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Rajdhani";

const { fontFamily } = loadFont("normal", {
  weights: ["500", "600", "700"],
  subsets: ["latin"],
});

const COLORS = {
  bg: "#030712",
  primary: "#22c55e",
  primaryDark: "#15803d",
  accent: "#4ade80",
  glow: "#22c55e",
  text: "#f9fafb",
  muted: "#9ca3af",
  lightning: "#000000",
};

export const HaoshokuIntro = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, overflow: "hidden" }}>
      {/* Background layers */}
      <BackgroundGradient />
      <HakiWaves />

      {/* Lightning appears early */}
      <Sequence from={15} durationInFrames={165}>
        <HakiLightning />
      </Sequence>

      {/* Logo - enters and moves up */}
      <Sequence from={0} durationInFrames={180}>
        <AnimatedLogo />
      </Sequence>

      {/* Title - appears after logo settles */}
      <Sequence from={40} durationInFrames={140}>
        <Title />
      </Sequence>

      {/* Taglines */}
      <Sequence from={60} durationInFrames={120}>
        <Taglines />
      </Sequence>

      {/* Features at bottom */}
      <Sequence from={85} durationInFrames={95}>
        <Features />
      </Sequence>
    </AbsoluteFill>
  );
};

const BackgroundGradient = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${COLORS.primaryDark}15 0%, transparent 50%)`,
        opacity,
      }}
    />
  );
};

const HakiWaves = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const baseOpacity = interpolate(frame, [0, 0.5 * fps, 2 * fps], [0, 0.25, 0.15], {
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [0, 3 * fps], [0.6, 1.3], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const ringOpacity = baseOpacity * (1 - i * 0.15);
        const size = 180 + i * 120;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: "50%",
              border: `2px solid ${COLORS.primary}`,
              opacity: Math.max(0, ringOpacity),
              transform: `scale(${scale})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const HakiLightning = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const opacity = interpolate(frame, [0, 15], [0, 0.85], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtle flicker effect
  const flicker = 1 - Math.sin(frame * 0.3) * 0.1;

  return (
    <AbsoluteFill style={{ opacity: opacity * flicker }}>
      <svg aria-hidden="true" width={width} height={height} style={{ position: "absolute" }}>
        {/* Left lightning cluster */}
        <g stroke={COLORS.lightning} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M120 100 L160 160 L130 175 L180 260" strokeWidth="6" />
          <path d="M80 180 L130 230 L100 250 L160 340" strokeWidth="5" opacity="0.8" />
          <path d="M60 280 L110 330 L85 350 L140 430" strokeWidth="4" opacity="0.6" />
        </g>

        {/* Right lightning cluster */}
        <g stroke={COLORS.lightning} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1160 100 L1120 160 L1150 175 L1100 260" strokeWidth="6" />
          <path d="M1200 180 L1150 230 L1180 250 L1120 340" strokeWidth="5" opacity="0.8" />
          <path d="M1220 280 L1170 330 L1195 350 L1140 430" strokeWidth="4" opacity="0.6" />
        </g>

        {/* Green glow layer */}
        <g stroke={COLORS.glow} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
          <path d="M120 100 L160 160 L130 175 L180 260" strokeWidth="12" filter="blur(4px)" />
          <path d="M1160 100 L1120 160 L1150 175 L1100 260" strokeWidth="12" filter="blur(4px)" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

const AnimatedLogo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entry animation
  const entryProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  const scale = interpolate(entryProgress, [0, 1], [0.3, 1]);
  const entryOpacity = interpolate(entryProgress, [0, 1], [0, 1]);

  // Move up after entry (starts at frame 35)
  const moveUpProgress = interpolate(frame, [35, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const yOffset = interpolate(moveUpProgress, [0, 1], [0, -120]);

  // Glow animation
  const glow = interpolate(frame, [10, 50], [0, 50], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtle pulse
  const pulse = 1 + Math.sin(frame * 0.08) * 0.02;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Img
        src={staticFile("logo.png")}
        style={{
          width: 280,
          height: 280,
          transform: `scale(${scale * pulse}) translateY(${yOffset}px)`,
          opacity: entryOpacity,
          filter: `drop-shadow(0 0 ${glow}px ${COLORS.glow})`,
        }}
      />
    </AbsoluteFill>
  );
};

const Title = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const scale = interpolate(progress, [0, 1], [0.7, 1]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const y = interpolate(progress, [0, 1], [30, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingTop: 180,
      }}
    >
      <h1
        style={{
          fontFamily,
          fontSize: 110,
          fontWeight: 700,
          margin: 0,
          color: "transparent",
          background: `linear-gradient(180deg, ${COLORS.accent} 0%, ${COLORS.primary} 45%, ${COLORS.primaryDark} 100%)`,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          transform: `scale(${scale}) translateY(${y}px)`,
          opacity,
          letterSpacing: 8,
          textShadow: `0 0 80px ${COLORS.glow}`,
        }}
      >
        HAOSHOKU
      </h1>
    </AbsoluteFill>
  );
};

const Taglines = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 100 },
  });

  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const y = interpolate(progress, [0, 1], [20, 0]);

  // Second line appears slightly after
  const progress2 = spring({
    frame: frame - 10,
    fps,
    config: { damping: 20, stiffness: 100 },
  });
  const opacity2 = interpolate(progress2, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
  const y2 = interpolate(progress2, [0, 1], [20, 0], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingTop: 340,
        flexDirection: "column",
      }}
    >
      <p
        style={{
          fontFamily,
          fontSize: 28,
          fontWeight: 500,
          color: COLORS.muted,
          margin: 0,
          letterSpacing: 6,
          textTransform: "uppercase",
          transform: `translateY(${y}px)`,
          opacity,
        }}
      >
        Color of the Supreme King
      </p>
      <p
        style={{
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: COLORS.primary,
          margin: 0,
          marginTop: 12,
          letterSpacing: 3,
          transform: `translateY(${y2}px)`,
          opacity: opacity2,
        }}
      >
        Multi-distro Linux Setup Toolkit
      </p>
    </AbsoluteFill>
  );
};

const Features = () => {
  const features = [
    { icon: "🐟", label: "Fish Shell" },
    { icon: "🦀", label: "Rust" },
    { icon: "🐳", label: "Docker" },
    { icon: "🤖", label: "Claude AI" },
  ];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 50,
      }}
    >
      <div style={{ display: "flex", gap: 20 }}>
        {features.map((f, i) => (
          <FeatureBadge key={f.label} icon={f.icon} label={f.label} delay={i * 4} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const FeatureBadge = ({
  icon,
  label,
  delay,
}: {
  icon: string;
  label: string;
  delay: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 120 },
  });

  const scale = interpolate(progress, [0, 1], [0.5, 1], { extrapolateLeft: "clamp" });
  const opacity = interpolate(progress, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
  const y = interpolate(progress, [0, 1], [20, 0], { extrapolateLeft: "clamp" });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        backgroundColor: `${COLORS.primary}18`,
        padding: "14px 24px",
        borderRadius: 12,
        border: `1.5px solid ${COLORS.primary}50`,
        transform: `scale(${scale}) translateY(${y}px)`,
        opacity,
        backdropFilter: "blur(8px)",
      }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span
        style={{
          fontFamily,
          fontSize: 17,
          fontWeight: 600,
          color: COLORS.text,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
    </div>
  );
};
