import styled from "styled-components";

const TextArea = styled.textarea<{ $width?: string; $height?: string; $background?: string }>`
  width: ${({ $width }) => $width ?? "400px"};
  height: ${({ $height }) => $height ?? "200px"};
  border: 1px solid lightgray;
  background-color: ${({ $background }) => $background ?? "#fafafa"};
  border-radius: 0;
  padding: 8px;
  resize: none;
  margin: auto;
  white-space: pre;
  overflow-wrap: normal;
`;

export default TextArea;
