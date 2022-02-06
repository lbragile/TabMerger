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
    primary: "#6dafff",
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
    surface: "#5e5e5e",
    onSurface: "#fff"
  }
};

const headers = {
  light: {
    primary: "#dde8ffb7",
    secondary: "#dfdfdfb7"
  },
  dark: {
    primary: "#98bbff2b",
    secondary: "#dfdfdf2b"
  }
};

export const ThemeOptions = {
  light: {
    colors: colors.light,
    links: links.light,
    popups: popups.light,
    headers: headers.light
  },
  dark: {
    colors: colors.dark,
    links: links.dark,
    popups: popups.dark,
    headers: headers.dark
  }
};
