import { createContext, useContext } from "react";

export const ConfirmContext = createContext(() => Promise.resolve(false));

export function useConfirm() {
  return useContext(ConfirmContext);
}
