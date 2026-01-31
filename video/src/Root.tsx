import { Composition, Folder, Still } from "remotion";
import { HaoshokuIntro } from "./HaoshokuIntro";
import { HaoshokuLogo, HaoshokuLogoMinimal } from "./HaoshokuLogo";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="HaoshokuIntro"
        component={HaoshokuIntro}
        durationInFrames={180}
        fps={30}
        width={1280}
        height={640}
      />
      <Folder name="Logos">
        <Still
          id="Logo"
          component={HaoshokuLogo}
          width={512}
          height={512}
        />
        <Still
          id="LogoMinimal"
          component={HaoshokuLogoMinimal}
          width={512}
          height={512}
        />
        <Still
          id="Favicon"
          component={HaoshokuLogoMinimal}
          width={64}
          height={64}
        />
      </Folder>
    </>
  );
};
