import { CheckboxContainer } from "~/styles/CheckboxContainer";

interface ICheckbox {
  id: string;
  text: string | JSX.Element;
  checked: boolean;
  setChecked: (arg: boolean) => void;
  disabled?: boolean;
}

export default function Checkbox({ id, text, checked, setChecked, disabled }: ICheckbox) {
  return (
    <CheckboxContainer>
      <input
        type="checkbox"
        id={id}
        name={id}
        checked={checked}
        onChange={() => setChecked(!checked)}
        disabled={!!disabled}
      />
      <label htmlFor={id}>{text}</label>
    </CheckboxContainer>
  );
}
