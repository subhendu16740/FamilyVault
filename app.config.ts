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
    name: "familyvault",
    slug: "familyvault",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "familyvault",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/expo.icon",
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      package: "com.anonymous.familyvault",
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
          backgroundColor: "#208AEF",
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
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
};
