import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import * as DESIGN from "../../constants/design";
import { AUTH_ERRORS } from "../../constants/auth";
import api from "../../services/meeting";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import ServiceLogo from "../../components/ui/ServiceLogo"
import bg from "../../assets/login/background.png";


export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();

  let hasError = false;
  setEmailError("");
  setPasswordError("");

  if (!email) {
    setEmailError(AUTH_ERRORS.EMAIL_REQUIRED);
    hasError = true;
  }
  if (!password) {
    setPasswordError(AUTH_ERRORS.PASSWORD_REQUIRED);
    hasError = true;
  }

  if (hasError) return;

  setLoading(true);

  try {
    const res = await api.post("/users/login/", { email, password });
    login(res.data);

    if (res.data.account_status === 0) {
      navigate("/change-password");
    } else if (res.data.role === "ADMIN") {
      navigate("/admin/users");
    } else {
      navigate("/projects");
    }
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } } | null)?.response?.data?.error ?? "";
    if (msg === "잠금 처리된 계정입니다.") {
      setPasswordError("계정이 잠금 처리되었습니다. 관리자에게 연락해주세요.");
    } else {
      setPasswordError(AUTH_ERRORS.INVALID_LOGIN);
    }
  } finally {
    setLoading(false);
  }
};

  return (
      <div
        className={`${DESIGN.BACKGROUND_COLORS.ivory} min-h-screen flex justify-center items-center bg-no-repeat`}
        style={{
          backgroundImage: `url(${bg})`,
          backgroundSize: "100% auto",
          backgroundPosition: "center 11.5vh", // 아래로 50px
        }}
      >
      <div className="w-[480px]">
        <ServiceLogo/>
        <div className={`${DESIGN.PADDING_SIZES["2xl"]} ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.MARGIN_TOP_SIZES["5xl"]} ${DESIGN.RADIUS_SIZES["2xl"]} flex justify-center items-center flex-col`}>
          <p className={`${DESIGN.FONT_SIZES.h3} justify-center ${DESIGN.MARGIN_BOTTOM_SIZES["3xl"]}`}>로그인</p>
          <form onSubmit={handleLogin} className={`flex flex-col ${DESIGN.GAP_SIZES["4xl"]} w-full`}>
            <Input
              id="email"
              label="이메일"
              size="md"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              placeholder="이메일을 입력해주세요"
              error={emailError}
            />
            <Input
              id="password"
              label="비밀번호"
              size="md"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              placeholder="비밀번호를 입력해주세요"
              error={passwordError}
            />

          <Button type="submit" disabled={loading} size="lg">
            로그인
          </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
