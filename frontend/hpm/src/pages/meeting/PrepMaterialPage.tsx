import { useRef, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getPrepMaterial, savePrepMaterial, generatePrepMaterial } from "../../services/meeting";

const MAX = { purpose: 500, currentState: 1000, regulations: 1000, expected: 500 };

export default function PrepMaterialPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meetingId = Number(id);

  const contentRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [purpose, setPurpose] = useState("");
  const [currentState, setCurrentState] = useState("");
  const [regulations, setRegulations] = useState("");
  const [expected, setExpected] = useState("");
  const [sources, setSources] = useState<{ document_id: number; title: string; file_url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [generationError, setGenerationError] = useState("");
  const [loadingMeetingId, setLoadingMeetingId] = useState(meetingId);

  // 다른 회의로 이동하면 렌더 중에 로딩·오류 상태를 다시 맞춘다.
  if (!Object.is(loadingMeetingId, meetingId)) {
    setLoadingMeetingId(meetingId);
    setLoading(true);
    setGenerationError("");
  }

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      try {
        const prep = await getPrepMaterial(meetingId);
        if (active) {
          if (prep.purpose || prep.project_status || prep.rule || prep.effect) {
            setPurpose(prep.purpose || "");
            setCurrentState(prep.project_status || "");
            setRegulations(prep.rule || "");
            setExpected(prep.effect || "");
            setSources(prep.sources || []);
            setLoading(false);
          } else {
            const generated = await generatePrepMaterial(meetingId);
            if (active) {
              setPurpose(generated.purpose || "");
              setCurrentState(generated.project_status || "");
              setRegulations(generated.rule || "");
              setExpected(generated.effect || "");
              setSources(generated.sources || []);
              setLoading(false);
            }
          }
        }
      } catch (err) {
        console.error("준비자료 로드/생성 실패:", err);
        if (active) {
          const message =
            (err as { response?: { data?: { error?: string } } }).response?.data?.error ||
            "준비자료 생성에 실패했습니다. OCR/AI 서버 상태를 확인한 뒤 다시 시도해주세요.";
          setGenerationError(message);
          setPurpose("");
          setCurrentState("");
          setRegulations("");
          setExpected("");
          setSources([]);
          setLoading(false);
        }
      }
    };
 
    loadData();
 
    return () => {
      active = false;
    };
  }, [meetingId]);

  const handleSave = async () => {
    try {
      await savePrepMaterial(meetingId, {
        purpose,
        project_status: currentState,
        rule: regulations,
        effect: expected,
      });
    } catch (err) {
      console.error("저장 실패:", err);
    }
  };

  const handlePdfDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const sections = [
        { label: "회의 목적", value: purpose },
        { label: "프로젝트 현재 상태", value: currentState },
        { label: "관련 규정 및 제약사항", value: regulations },
        { label: "회의 종료 후 기대 결과", value: expected },
        { label: "출처", value: sources && sources.length > 0 ? sources.map(r => `- ${r.title}`).join("\n") : "- 출처가 없습니다." },
      ];

      const wrapper = document.createElement("div");
      wrapper.style.cssText = `
        position:absolute; top:-9999px; left:-9999px;
        width:700px; background:#fff;
        padding:48px 48px 60px;
        font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
        box-sizing:border-box; color:#111;
      `;

      // 제목
      const title = document.createElement("div");
      title.style.cssText = `
        text-align:center; font-size:17px; font-weight:700;
        margin-bottom:24px;
      `;
      title.textContent = "회의 준비 자료";
      wrapper.appendChild(title);

      // 표 컨테이너 
      const outer = document.createElement("div");
      outer.style.cssText = `width:100%;`;

      sections.forEach(({ label, value }, idx) => {
        const isFirst = idx === 0;

        // 섹션 헤더
        const header = document.createElement("div");
        header.style.cssText = `
          padding:10px 10px 20px;
          text-align:center;
          line-height:1.3;
          font-size:13px; font-weight:600;
          border-left:1px solid #000;
          border-right:1px solid #000;
          border-top:${isFirst ? "1px solid #000" : "none"};
          border-bottom:1px solid #000;
          box-sizing:border-box;
        `;
        header.textContent = label;
        outer.appendChild(header);

        // 내용 행
        const content = document.createElement("div");
        content.style.cssText = `
          padding:14px 18px;
          font-size:12px; line-height:1.9;
          white-space:pre-wrap; word-break:break-word;
          min-height:60px;
          border-left:1px solid #000;
          border-right:1px solid #000;
          border-top:none;
          border-bottom:1px solid #000;
          box-sizing:border-box;
        `;
        content.textContent = value;
        outer.appendChild(content);
      });

      wrapper.appendChild(outer);
      document.body.appendChild(wrapper);

      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: 700,
        scrollX: 0,
        scrollY: 0,
      });
      document.body.removeChild(wrapper);

      const imgData = canvas.toDataURL("image/png");
      const pageW = 210;
      const pageH = Math.ceil(canvas.height * pageW / canvas.width);
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: [pageW, pageH] });
      pdf.addImage(imgData, "PNG", 0, 0, pageW, pageH);
      pdf.save("회의_준비_자료.pdf");
    } catch (e) {
      console.error("PDF 생성 실패:", e);
      alert("PDF 생성에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  };

  const sections = [
    { label: "회의 목적", value: purpose, onChange: setPurpose, max: MAX.purpose },
    { label: "프로젝트 현재 상태", value: currentState, onChange: setCurrentState, max: MAX.currentState },
    { label: "관련 규정 및 제약사항", value: regulations, onChange: setRegulations, max: MAX.regulations },
    { label: "회의 종료 후 기대 결과", value: expected, onChange: setExpected, max: MAX.expected },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-10 px-6">
        <div className="relative w-16 h-16 mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-[#6A1FEB]/20 animate-ping"></div>
          <div className="absolute inset-0 rounded-full border-4 border-t-[#6A1FEB] border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
        </div>
        <h3 className="text-lg font-medium text-[#141414] mb-2">회의 준비 자료 생성 중</h3>
        <p className="text-xs text-[#969696] text-center max-w-sm">
          RunPod AI와 내부 문서를 기반으로 프로젝트 컨텍스트를 파악하여 회의 준비 자료를 자동 생성하고 있습니다. 잠시만 기다려 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full py-10 px-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-[24px] font-medium text-[#141414] mb-1">회의 준비 자료 생성</h2>
          <p className="text-[12px] text-[#969696]">회의 준비에 참조할 수 있는 자료입니다.</p>
        </div>
        <div className="flex gap-2 mt-1">
          <button
            onClick={async () => {
              if (isEditing) {
                await handleSave();
              }
              setIsEditing(v => !v);
            }}
            className="px-4 py-2 text-[13px] rounded-lg border transition"
            style={isEditing
              ? { backgroundColor: "#6A1FEB", color: "#ffffff", borderColor: "#6A1FEB" }
              : { backgroundColor: "#ffffff", color: "#141414", borderColor: "#E6E1E6" }
            }
          >
            {isEditing ? "완료" : "수정하기"}
          </button>
          <button
            onClick={handlePdfDownload}
            disabled={downloading}
            className="px-4 py-2 text-[13px] text-white rounded-lg transition disabled:opacity-60"
            style={{ backgroundColor: "#6A1FEB" }}
          >
            {downloading ? "생성 중..." : "pdf 다운로드"}
          </button>
        </div>
      </div>

      {generationError ? (
        <div className="mb-6 rounded-xl border border-[#F04438]/30 bg-[#FFF4F4] px-4 py-3 text-[13px] font-medium text-[#B42318]">
          {generationError}
        </div>
      ) : null}

      {/* 편집 가능 섹션들 */}
      <div ref={contentRef} className="space-y-6">
        {sections.map(({ label, value, onChange, max }) => (
          <div key={label}>
            <p className="text-[14px] text-[#141414] font-medium mb-2">{label}</p>
            <div className="relative">
              <textarea
                value={value}
                onChange={e => isEditing && onChange(e.target.value.slice(0, max))}
                readOnly={!isEditing}
                rows={label === "프로젝트 현재 상태" || label === "관련 규정 및 제약사항" ? 10 : 6}
                className="w-full border border-[#E6E1E6] rounded-xl px-4 py-3 text-[13px] text-[#141414] resize-none outline-none transition bg-white"
                style={{ cursor: isEditing ? "text" : "default", borderColor: isEditing ? undefined : "#E6E1E6" }}
              />
              <span className="absolute bottom-3 right-4 text-[11px] text-[#969696]">
                {value.length}/{max}
              </span>
            </div>
          </div>
        ))}

        {/* 출처 */}
        <div>
          <p className="text-[14px] text-[#141414] font-medium mb-2">출처</p>
          <div className="border border-[#E6E1E6] rounded-xl px-4 py-3 bg-white space-y-2">
            {sources && sources.length > 0 ? (
              sources.map((src, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px]">
                  <span className="text-[#767676]">- {src.title}</span>
                  {src.file_url ? (
                    <a
                      href={src.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#6A1FEB] hover:underline font-semibold cursor-pointer"
                    >
                      더보기
                    </a>
                  ) : (
                    <span className="text-gray-400 font-medium select-none text-[12px]">더보기 없음</span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-[13px] text-[#969696]">- 출처가 없습니다.</p>
            )}
          </div>
        </div>
      </div>

      {/* 다음 버튼 */}
      <div className="flex justify-end mt-8">
        <button
          onClick={async () => {
            await handleSave();
            navigate(`/meetings/${meetingId}`);
          }}
          className="px-8 py-2.5 text-white text-[14px] rounded-lg transition"
          style={{ backgroundColor: "#6A1FEB" }}
        >
          다음
        </button>
      </div>
    </div>
  );
}
