jest.mock("react-toastify", () => {
  const actual = jest.requireActual("react-toastify");
  Object.assign(actual, { toast: jest.fn() });
  return actual;
});
