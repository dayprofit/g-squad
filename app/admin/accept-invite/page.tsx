import { AcceptAdminInvite } from '@/components/admin/accept-invite';

export default async function AcceptAdminInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptAdminInvite token={token ?? ''} />;
}
