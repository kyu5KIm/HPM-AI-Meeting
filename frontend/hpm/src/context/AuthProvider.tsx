import { useState, useEffect, type ReactNode } from "react";
import type { User } from "../types/user";
import { getMe, logoutUser } from "../services/users";
import { AuthContext } from "./AuthContext";

const normalizeUser = (user: Partial<User> & { user_id?: number; users_id?: number }): User => {
  const id = user.users_id ?? user.user_id ?? 0;
  return {
    ...user,
    user_id: id,
    users_id: id,
    email: user.email ?? "",
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [projectId, setProjectId] = useState<number | null>(() => {
    const v = localStorage.getItem("hpm_project_id");
    return v ? Number(v) : null;
  });
  const [projectName, setProjectName] = useState(() => localStorage.getItem("hpm_project_name") || "");

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const data = await getMe();
        setUser(normalizeUser(data));
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMe();
  }, []);


  const login = (u: User) => {
    setUser(normalizeUser(u));
    localStorage.setItem("hpm_user", JSON.stringify(u));
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch (error) {
      console.error("Backend logout failed:", error);
    }
    setUser(null);
    setProjectId(null);
    setProjectName("");
    localStorage.removeItem("hpm_project_id");
    localStorage.removeItem("hpm_project_name");
    localStorage.removeItem("hpm_user");
  };

  const selectProject = (id: number, name: string) => {
    setProjectId(id);
    setProjectName(name);
    localStorage.setItem("hpm_project_id", String(id));
    localStorage.setItem("hpm_project_name", name);
  };

  const clearProject = () => {
    setProjectId(null);
    setProjectName("");
    localStorage.removeItem("hpm_project_id");
    localStorage.removeItem("hpm_project_name");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, projectId, projectName, login, logout, selectProject, clearProject }}>
      {isLoading ? <div>Loading...</div> : children}
    </AuthContext.Provider>
  );
}
