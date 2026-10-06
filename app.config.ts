import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  // In Firebase Studio, WEB_HOST is set to the workspace hostname.
  // The web preview is served from port 9000, so we need to allow
  // that origin for CORS in the Expo dev server.
  const webHost = process.env.WEB_HOST;
  const routerExtra: Record<string, unknown> = {};
  if (webHost) {
    routerExtra.origin = `https://9000-${webHost}`;
  }

  return {
    ...config,
    name: "AskLocker",
    slug: "asklocker",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "asklocker",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/expo.icon",
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#2A3D66",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      package: "com.asklocker.app",
    },
    web: {
      bundler: "metro",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#2A3D66",
          android: {
            image: "./assets/images/splash-icon.png",
            imageWidth: 76,
          },
        },
      ],
      "expo-web-browser",
    ],
    extra: {
      router: routerExtra,
      // Settings › About. Stamped when the bundle is built, so for a web
      // deploy this is the day it was released; Vercel also says which commit.
      releaseDate: new Date().toISOString(),
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
};
