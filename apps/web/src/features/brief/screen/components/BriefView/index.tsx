import { ReviewSessionProvider } from "@web/features/review/session";
import { BriefScreen, type BriefScreenProps } from "../BriefScreen";

export function BriefView({
  reading,
  address,
  pr,
  review,
  conversation,
}: BriefScreenProps) {
  return (
    <ReviewSessionProvider
      briefId={reading.briefId}
      model={reading.model}
      reads={review?.sessionReads}
      session={review?.session}
      writes={review?.writes}
    >
      <BriefScreen
        reading={reading}
        address={address}
        pr={pr}
        review={review}
        conversation={conversation}
      />
    </ReviewSessionProvider>
  );
}
