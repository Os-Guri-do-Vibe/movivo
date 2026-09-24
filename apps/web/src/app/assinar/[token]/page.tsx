import type { Metadata } from 'next';

import { PlanSelector } from '@/components/assinatura/plan-selector';
import { SubscriptionFrame } from '@/components/assinatura/subscription-frame';

export const metadata: Metadata = {
  title: 'Checkout seguro',
  description: 'Finalize sua assinatura MOVIVO com segurança.',
  robots: { index: false, follow: false },
};

export default async function AssinarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <SubscriptionFrame>
      <PlanSelector token={token} />
    </SubscriptionFrame>
  );
}
