import { PasswordReset } from '@/components/admin/password-reset';

export default async function PasswordResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <PasswordReset token={token ?? ''} />;
}
