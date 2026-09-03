'use client';

import { Camera, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  changeAccountPassword,
  getAccountProfile,
  updateAccountProfile,
  uploadAccountAvatar,
  type AccountProfile,
} from '@/lib/account-api';
import { DashboardApiError } from '@/lib/dashboard-api';
import { ROLE_LABELS } from '@/lib/control-center-access';
import { maskBrazilianPhone, toE164BrazilianPhone } from '@/lib/phone-mask';

const INPUT_CLASS =
  'min-h-11 rounded-lg border border-input bg-background px-3 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof DashboardApiError ? caught.message : fallback;
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-h3 font-bold text-foreground">{title}</h2>
      {description ? <p className="mt-1 text-label text-muted-foreground">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-label font-semibold text-foreground">{value}</p>
    </div>
  );
}

function AvatarCircle({ avatarUrl, initials }: { avatarUrl: string | null; initials: string }) {
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- vem de outra origem (API), fora do domínio otimizado pelo next/image.
    <img src={avatarUrl} alt="" className="size-16 shrink-0 rounded-full object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-16 shrink-0 items-center justify-center rounded-full bg-verde-pulso text-h3 font-semibold text-petroleo"
    >
      {initials}
    </span>
  );
}

export function AccountSettings() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const data = await getAccountProfile();
      setProfile(data);
      setName(data.name ?? '');
      setPhoneNumber(maskBrazilianPhone(data.phoneNumber));
    } catch (caught) {
      setLoadError(errorMessage(caught, 'Não foi possível carregar a sua conta.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setSavingProfile(true);
    try {
      const input: { name?: string; phoneNumber?: string } = {};
      if (name.trim() !== (profile?.name ?? '')) input.name = name.trim();
      const e164Phone = toE164BrazilianPhone(phoneNumber);
      if (e164Phone !== profile?.phoneNumber) input.phoneNumber = e164Phone;
      if (Object.keys(input).length === 0) {
        setProfileSuccess('Nada para salvar.');
        return;
      }
      const updated = await updateAccountProfile(input);
      setProfile(updated);
      setProfileSuccess('Perfil atualizado.');
      router.refresh();
    } catch (caught) {
      setProfileError(errorMessage(caught, 'Não foi possível salvar o perfil.'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function onAvatarSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError('');
    setUploadingAvatar(true);
    try {
      const updated = await uploadAccountAvatar(file);
      setProfile(updated);
      router.refresh();
    } catch (caught) {
      setAvatarError(errorMessage(caught, 'Não foi possível enviar a foto.'));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação não bate com a nova senha.');
      return;
    }
    setSavingPassword(true);
    try {
      await changeAccountPassword({ currentPassword, newPassword });
      setPasswordSuccess('Senha atualizada.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setPasswordError(errorMessage(caught, 'Não foi possível trocar a senha.'));
    } finally {
      setSavingPassword(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="rounded-lg border border-coral bg-card p-3 text-label">
        {loadError}
      </p>
    );
  }

  if (!profile) {
    return (
      <p className="flex items-center gap-2 text-label text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Carregando…
      </p>
    );
  }

  const initials = (profile.name?.trim() || ROLE_LABELS[profile.role]).slice(0, 2).toUpperCase();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card title="Perfil" description="Edite nome e telefone usados para acessar o painel.">
        <div className="flex items-center gap-4">
          <AvatarCircle avatarUrl={profile.avatarUrl} initials={initials} />
          <div className="flex flex-col gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => void onAvatarSelected(event)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingAvatar ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Camera aria-hidden="true" className="size-4" />
              )}
              {uploadingAvatar ? 'Enviando…' : 'Trocar foto'}
            </Button>
            <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP.</p>
          </div>
        </div>
        {avatarError ? (
          <p role="alert" className="mt-3 text-label text-destructive">
            {avatarError}
          </p>
        ) : null}

        <form onSubmit={submitProfile} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="conta-nome" className="text-label font-semibold">
              Nome completo
            </label>
            <input
              id="conta-nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="conta-telefone" className="text-label font-semibold">
              Telefone
            </label>
            <div className="flex">
              <span className="flex min-h-11 items-center rounded-l-lg border border-r-0 border-input bg-muted px-3 text-body text-muted-foreground">
                +55
              </span>
              <input
                id="conta-telefone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(maskBrazilianPhone(event.target.value))}
                placeholder="(11) 99999-9999"
                required
                className="min-h-11 min-w-0 flex-1 rounded-r-lg border border-input bg-background px-3 text-body focus-visible:z-10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              />
            </div>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {profileError ? (
              <p role="alert" className="text-label text-destructive">
                {profileError}
              </p>
            ) : null}
            {profileSuccess ? (
              <p className="text-label text-verde-pulso">{profileSuccess}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={savingProfile} className="self-start">
            {savingProfile ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </form>
      </Card>

      <Card title="Informações de Cadastro" description="Dados principais da sua conta.">
        <div>
          <InfoRow label="Nome completo" value={profile.name ?? 'Sem nome cadastrado'} />
          <InfoRow label="E-mail de acesso" value={profile.email ?? '—'} />
          <InfoRow label="Telefone" value={`+55 ${maskBrazilianPhone(profile.phoneNumber)}`} />
          <InfoRow label="Papel" value={ROLE_LABELS[profile.role]} />
        </div>
      </Card>

      <div className="lg:col-span-2">
        <Card title="Segurança" description="Troque a senha usada para acessar o painel.">
          <form onSubmit={submitPassword} className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label htmlFor="conta-senha-atual" className="text-label font-semibold">
                Senha atual
              </label>
              <input
                id="conta-senha-atual"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                maxLength={200}
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="conta-senha-nova" className="text-label font-semibold">
                Nova senha
              </label>
              <input
                id="conta-senha-nova"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={12}
                maxLength={200}
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="conta-senha-confirmar" className="text-label font-semibold">
                Confirmar nova senha
              </label>
              <input
                id="conta-senha-confirmar"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={12}
                maxLength={200}
                className={INPUT_CLASS}
              />
            </div>

            <div className="sm:col-span-3" aria-live="polite" aria-atomic="true">
              {passwordError ? (
                <p role="alert" className="text-label text-destructive">
                  {passwordError}
                </p>
              ) : null}
              {passwordSuccess ? (
                <p className="text-label text-verde-pulso">{passwordSuccess}</p>
              ) : null}
            </div>

            <Button type="submit" disabled={savingPassword} className="self-start sm:col-span-3">
              {savingPassword ? 'Salvando…' : 'Salvar nova senha'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
