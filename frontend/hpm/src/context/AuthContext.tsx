import { createContext, useContext } from "react";
import type { AuthContextType } from "../types/user";

// Provider 컴포넌트는 AuthProvider.tsx에 있다(Fast Refresh 규칙상 훅과 분리).
export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
