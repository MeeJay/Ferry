import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlert, Clock } from 'lucide-react';
import type { RegisterResult } from '@ferry/shared';
import { api, errorMessage } from '@/api/client';
import { useApp } from '@/store/app';
import { PageLoader } from '@/components/ui';
import { AccountShell, Notice } from './Register';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setMe = useApp((s) => s.setMe);
  const [state, setState] = useState<{ status: 'loading' | 'pending' | 'error'; message?: string }>({ status: 'loading' });
  const sent = useRef(false);

  useEffect(() => {
    // Tokens are single-use: never post twice (React StrictMode runs effects twice in dev).
    if (sent.current) return;
    sent.current = true;
    const token = params.get('token');
    if (!token) { setState({ status: 'error', message: 'Lien incomplet.' }); return; }
    api.post<RegisterResult>('/api/auth/verify-email', { token })
      .then((r) => {
        if (r.status === 'active') { setMe(r.me); navigate('/', { replace: true }); } else setState({ status: 'pending' });
      })
      .catch((err) => setState({ status: 'error', message: errorMessage(err) }));
  }, [params, navigate, setMe]);

  const back = <Link to="/login" className="text-sm font-semibold text-accent">Retour à la connexion</Link>;
  return (
    <AccountShell>
      {state.status === 'loading' && <PageLoader />}
      {state.status === 'pending' && <Notice icon={<Clock />} title="Adresse confirmée" action={back}>Merci ! Un administrateur doit encore valider votre compte. Vous recevrez un e-mail dès qu’il sera activé.</Notice>}
      {state.status === 'error' && <Notice icon={<CircleAlert />} title="Lien invalide" action={back}>{state.message} Depuis la page de connexion, vous pouvez demander un nouveau lien.</Notice>}
    </AccountShell>
  );
}
