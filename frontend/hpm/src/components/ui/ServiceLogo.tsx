import { type ComponentPropsWithoutRef } from "react";
import * as DESIGN from "../../constants/design";
import logo from "../../assets/login/logo.png"

type ServiceLogoProps = ComponentPropsWithoutRef<"div">;

// 전달된 className은 아래 className=""가 덮어쓴다(기존 동작 유지).
export default function ServiceLogo(props: ServiceLogoProps) {
  return (
    <div
      {...props}
      className=""
    >
      <div className={`flex justify-center items-center ${DESIGN.GAP_SIZES.xl}`}><img src={logo} alt="" className="w-[45px]" /><p className={DESIGN.FONT_SIZES.h2}>회의피하지마</p></div>
    </div>
  );
}
