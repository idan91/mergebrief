import { ReviewSessionProvider } from "@web/features/review/session";
import { BriefScreen, type BriefScreenProps } from "../BriefScreen";

export function BriefView(props: BriefScreenProps) {
  const { reading, review } = props;

  return (
    <ReviewSessionProvider
      briefId={reading.briefId}
      model={reading.model}
      reads={review?.sessionReads}
      session={review?.session}
      writes={review?.writes}
    >
      <BriefScreen {...props} />
    </ReviewSessionProvider>
  );
}
