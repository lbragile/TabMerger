const colors = {
  light: {
    primary: "#007bff",
    secondary: "#f0f0f0",
    background: "#fff",
    surface: "#fff",
    error: "#ffdddd",
    success: "#ddffdd",
    onPrimary: "#000",
    onSecondary: "#000",
    onBackground: "#000",
    onSurface: "#000",
    onError: "red",
    onSuccess: "green"
  },
  dark: {
    primary: "#459aff",
    secondary: "#404040",
    background: "#212121",
    surface: "#303030",
    error: "#ff4444",
    success: "#44ff44",
    onPrimary: "#000",
    onSecondary: "#fff",
    onBackground: "#fff",
    onSurface: "#fff",
    onError: "red",
    onSuccess: "green"
  }
};

const links = {
  light: {
    onSurface: "#0645ad",
    onBackground: "#0645ad"
  },
  dark: {
    onSurface: "#c6d5ff",
    onBackground: "#c6d5ff"
  }
};

const popups = {
  light: {
    surface: "#303030",
    onSurface: "#fff"
  },
  dark: {
    surface: "#eee",
    onSurface: "#000"
  }
};

export const ThemeOptions = {
  light: {
    colors: colors.light,
    links: links.light,
    popups: popups.light
  },
  dark: {
    colors: colors.dark,
    links: links.dark,
    popups: popups.dark
  }
};
