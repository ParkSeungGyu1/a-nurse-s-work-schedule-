export const DAYS_KR = ["일", "월", "화", "수", "목", "금", "토"];

export const PRIORITY_MODE_LABELS: Record<string, string> = {
  balanced: "균형 우선",
  fairness: "공정성 우선",
  coverage: "인원 충원 우선",
  new_nurse_protection: "신규 보호 우선",
};

export function getRecommendationTypeLabel(type: string) {
  if (type === "understaffed_shift") return "인원 부족";
  if (type === "fairness_warning") return "공정성 확인";
  return "규칙 충돌";
}

export function getRecommendationDecisionMeta(item: {
  shortageCount?: number | null;
  strictCandidateCount: number;
  fallbackCandidateCount: number;
}) {
  const shortageCount = item.shortageCount ?? 0;
  const totalCandidates = item.strictCandidateCount + item.fallbackCandidateCount;

  if (shortageCount > 0) {
    if (item.strictCandidateCount >= shortageCount) {
      return {
        label: "규칙 내 충원 가능",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }

    if (totalCandidates >= shortageCount && totalCandidates > 0) {
      return {
        label: "차선 선택 필요",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    }

    return {
      label: "추가 인력 필요",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (item.strictCandidateCount > 0) {
    return {
      label: "바로 조정 가능",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (item.fallbackCandidateCount > 0) {
    return {
      label: "검토 후 적용",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "추천 후보 없음",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  };
}

export function getExperienceLabel(level: string) {
  if (level === "new") return "신규";
  if (level === "senior") return "책임";
  return "경력";
}

export function getSuggestedShiftLabel(shiftType?: string) {
  if (!shiftType) return "근무 조정";
  return shiftType === "OFF" ? "OFF" : `${shiftType} 배치`;
}

export function getValidationRuleLabel(ruleCode?: string | null) {
  switch (ruleCode) {
    case "UNDERSTAFFED":
      return "인원 부족";
    case "NEW_NURSE_RATIO":
      return "신규 비율 초과";
    case "MIN_EXPERIENCED":
      return "경력 간호사 부족";
    case "E_TO_D":
      return "E 다음날 D 금지";
    case "MAX_CONSECUTIVE_WORK":
      return "연속 근무 초과";
    case "OFF_AFTER_CONSECUTIVE_WORK":
      return "연속 근무 후 OFF 부족";
    case "OFF_AFTER_NIGHT":
      return "나이트 후 OFF 부족";
    case "MAX_CONSECUTIVE_NIGHT":
      return "연속 나이트 초과";
    case "NIGHT_KEEP_CLUSTERED":
      return "전담 나이트 몰림";
    case "NIGHT_KEEP_NON_NIGHT_SHIFT":
      return "전담 간호사 D/E 배정";
    case "NIGHT_KEEP_IMBALANCE":
      return "전담 나이트 편중";
    case "PAIR_RULE_SAME_SHIFT":
      return "프리셉터 동일 근무 불일치";
    case "PAIR_RULE_DIFFERENT_SHIFT":
      return "프리셉터 분리 근무 불일치";
    default:
      return "검토 필요";
  }
}

export function getValidationSummary(item: {
  ruleCode?: string | null;
  date?: string | null;
  shiftType?: string | null;
  nurseName?: string | null;
  message: string;
}) {
  const date = item.date ? item.date.slice(5) : "해당 날짜";
  const shift = item.shiftType ? ` ${item.shiftType}` : "";
  const nurseName = item.nurseName ?? "해당 간호사";

  switch (item.ruleCode) {
    case "UNDERSTAFFED":
      return `${date}${shift} 근무 인원이 부족합니다.`;
    case "NEW_NURSE_RATIO":
      return `${date}${shift} 근무의 신규 간호사 비율이 설정값을 넘었습니다.`;
    case "MIN_EXPERIENCED":
      return `${date}${shift} 근무의 경력 간호사가 부족합니다.`;
    case "E_TO_D":
      return `${nurseName} 간호사에게 E 다음날 D 배정이 발생했습니다.`;
    case "MAX_CONSECUTIVE_WORK":
      return `${nurseName} 간호사의 연속 근무가 최대 기준을 초과했습니다.`;
    case "OFF_AFTER_CONSECUTIVE_WORK":
      return `${nurseName} 간호사에게 연속 근무 후 OFF가 부족합니다.`;
    case "OFF_AFTER_NIGHT":
      return `${nurseName} 간호사에게 나이트 후 OFF가 부족합니다.`;
    case "MAX_CONSECUTIVE_NIGHT":
      return `${nurseName} 간호사의 연속 나이트가 최대 기준을 초과했습니다.`;
    case "NIGHT_KEEP_CLUSTERED":
      return `${date} N 근무에 전담 나이트 간호사가 몰려 있습니다.`;
    case "NIGHT_KEEP_NON_NIGHT_SHIFT":
      return `${nurseName} 간호사가 전담 나이트인데 D/E에 배정되었습니다.`;
    case "NIGHT_KEEP_IMBALANCE":
      return `전담 나이트 간호사 사이의 월간 나이트 횟수 편차가 큽니다.`;
    case "PAIR_RULE_SAME_SHIFT":
      return `${date} 프리셉터 페어가 같은 근무로 맞춰지지 않았습니다.`;
    case "PAIR_RULE_DIFFERENT_SHIFT":
      return `${date} 프리셉터 페어가 분리 근무로 맞춰지지 않았습니다.`;
    default:
      return item.message;
  }
}
