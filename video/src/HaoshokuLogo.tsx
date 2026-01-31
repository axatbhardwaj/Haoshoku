import { AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/Rajdhani";

const { fontFamily } = loadFont("normal", {
  weights: ["700"],
  subsets: ["latin"],
});

const COLORS = {
  bg: "#0d1117",
  primary: "#22c55e", // Green
  secondary: "#10b981", // Emerald
  accent: "#4ade80", // Light green
  dark: "#166534", // Dark green
  lightning: "#fbbf24", // Gold/yellow for Haki lightning
  black: "#000000",
};

export const HaoshokuLogo = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Background Haki pressure effect - radiating circles */}
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          background: `radial-gradient(circle, ${COLORS.primary}20 0%, ${COLORS.primary}10 30%, transparent 60%)`,
          filter: "blur(20px)",
        }}
      />

      {/* Conqueror's Haki wave rings */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 280 + i * 60,
            height: 280 + i * 60,
            borderRadius: "50%",
            border: `2px solid ${COLORS.primary}`,
            opacity: 0.15 - i * 0.04,
          }}
        />
      ))}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Conqueror's Haki black lightning bolts */}
        <svg
          width="450"
          height="450"
          viewBox="0 0 450 450"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        >
          {/* Black lightning - signature Conqueror's Haki effect */}
          <g stroke={COLORS.black} strokeWidth="4" fill="none" strokeLinecap="round">
            {/* Left side bolts */}
            <path d="M70 180 L90 200 L75 210 L100 250" opacity="0.9" />
            <path d="M50 220 L75 235 L60 250 L90 290" opacity="0.7" />

            {/* Right side bolts */}
            <path d="M380 180 L360 200 L375 210 L350 250" opacity="0.9" />
            <path d="M400 220 L375 235 L390 250 L360 290" opacity="0.7" />

            {/* Top bolts */}
            <path d="M200 50 L210 80 L195 90 L220 130" opacity="0.6" />
            <path d="M250 50 L240 80 L255 90 L230 130" opacity="0.6" />
          </g>

          {/* Gold outline on black lightning for depth */}
          <g stroke={COLORS.lightning} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.4">
            <path d="M70 180 L90 200 L75 210 L100 250" />
            <path d="M380 180 L360 200 L375 210 L350 250" />
          </g>
        </svg>

        {/* Main "H" with Haki effect */}
        <div style={{ position: "relative" }}>
          {/* Haki glow behind */}
          <div
            style={{
              position: "absolute",
              inset: -20,
              background: `radial-gradient(ellipse, ${COLORS.primary}40 0%, transparent 70%)`,
              filter: "blur(15px)",
            }}
          />

          {/* The H */}
          <div
            style={{
              fontFamily,
              fontSize: 220,
              fontWeight: 700,
              color: "transparent",
              background: `linear-gradient(180deg, ${COLORS.accent} 0%, ${COLORS.primary} 40%, ${COLORS.dark} 100%)`,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              lineHeight: 1,
              filter: `drop-shadow(0 0 30px ${COLORS.primary}80)`,
            }}
          >
            H
          </div>
        </div>

        {/* Pressure crack lines at bottom */}
        <svg
          width="300"
          height="60"
          viewBox="0 0 300 60"
          style={{ marginTop: -30, opacity: 0.6 }}
        >
          <g stroke={COLORS.primary} strokeWidth="2" fill="none">
            <path d="M150 0 L140 20 L150 25 L135 45 L145 50 L130 60" />
            <path d="M150 0 L160 20 L150 25 L165 45 L155 50 L170 60" />
            <path d="M150 10 L120 35 L130 40 L100 60" opacity="0.5" />
            <path d="M150 10 L180 35 L170 40 L200 60" opacity="0.5" />
          </g>
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// Minimal version - just H with Haki aura
export const HaoshokuLogoMinimal = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Haki aura */}
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          background: `radial-gradient(circle, ${COLORS.primary}30 0%, transparent 60%)`,
          filter: "blur(25px)",
        }}
      />

      {/* Black lightning accents */}
      <svg
        width="400"
        height="400"
        viewBox="0 0 400 400"
        style={{
          position: "absolute",
          pointerEvents: "none",
        }}
      >
        <g stroke={COLORS.black} strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M90 160 L110 185 L95 195 L120 230" opacity="0.8" />
          <path d="M310 160 L290 185 L305 195 L280 230" opacity="0.8" />
        </g>
      </svg>

      <div
        style={{
          fontFamily,
          fontSize: 280,
          fontWeight: 700,
          color: "transparent",
          background: `linear-gradient(180deg, ${COLORS.accent} 0%, ${COLORS.primary} 50%, ${COLORS.dark} 100%)`,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          lineHeight: 1,
          filter: `drop-shadow(0 0 25px ${COLORS.primary}60)`,
        }}
      >
        H
      </div>
    </AbsoluteFill>
  );
};
