import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const stateCookieName = 'os7_oauth_state';

export default {
  id: 'os7',
  handler(router, { database, env, getSchema, logger, services }) {
    router.get('/login', (req, res) => {
      const config = readConfig(env);
      if (!config) {
        logger?.error('OS7 OAuth bridge is not configured.');
        return res.status(503).send('OS7 OAuth is not configured.');
      }

      const redirect = safeRedirect(req.query.redirect);
      const state = signState(
        {
          nonce: randomBytes(18).toString('base64url'),
          redirect
        },
        config.secret
      );
      const callbackUrl = createCallbackUrl(config.publicUrl);
      const authorizeUrl = new URL(config.authorizeUrl);

      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', config.clientId);
      authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
      authorizeUrl.searchParams.set('scope', config.scope);
      authorizeUrl.searchParams.set('state', state);

      res.cookie(stateCookieName, state, {
        httpOnly: true,
        sameSite: env.SESSION_COOKIE_SAME_SITE || 'lax',
        secure: readBoolean(env.SESSION_COOKIE_SECURE),
        maxAge: 5 * 60 * 1000
      });
      return res.redirect(authorizeUrl.toString());
    });

    router.get('/callback', async (req, res) => {
      const config = readConfig(env);
      if (!config) {
        logger?.error('OS7 OAuth bridge is not configured.');
        return res.status(503).send('OS7 OAuth is not configured.');
      }

      try {
        const state = typeof req.query.state === 'string' ? req.query.state : '';
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const cookieState = req.cookies?.[stateCookieName];

        if (!code || !state) {
          return res.status(400).send('Invalid OS7 OAuth response.');
        }

        const statePayload = verifyState(state, config.secret);
        if (!statePayload) {
          return res.status(400).send('Invalid OS7 OAuth state.');
        }

        if (cookieState && cookieState !== state) {
          return res.status(400).send('Invalid OS7 OAuth state cookie.');
        }

        const token = await exchangeCode({
          code,
          config,
          redirectUri: createCallbackUrl(config.publicUrl)
        });
        const profile = await fetchProfile(config.userinfoUrl, token.access_token);
        const email = typeof profile.email === 'string' ? profile.email : '';

        if (!email) {
          return res.status(400).send('OS7 profile does not include an email.');
        }

        const schema = await getSchema();
        const password = `Os7-${randomBytes(24).toString('base64url')}aA1!`;
        const role = await resolveRoleId(database, config.defaultRoleId);
        const userId = await ensureDirectusUser({
          database,
          email,
          name: typeof profile.name === 'string' ? profile.name : email,
          password,
          role,
          schema,
          services
        });

        logger?.info({ email, userId }, 'OS7 OAuth login succeeded.');

        const { AuthenticationService } = services;
        const authentication = new AuthenticationService({
          accountability: {
            admin: true,
            ip: req.ip,
            userAgent: req.get('user-agent')?.substring(0, 1024) ?? null
          },
          knex: database,
          schema
        });
        const { accessToken } = await authentication.login(
          'default',
          {
            email,
            password
          },
          {
            session: true
          }
        );

        res.clearCookie(stateCookieName);
        res.cookie(env.SESSION_COOKIE_NAME, accessToken, {
          httpOnly: true,
          sameSite: env.SESSION_COOKIE_SAME_SITE || 'strict',
          secure: readBoolean(env.SESSION_COOKIE_SECURE)
        });
        setDirectusOnboardingCookies(res, env);

        return res.redirect(statePayload.redirect || '/admin');
      } catch (error) {
        logger?.error(error, 'OS7 OAuth callback failed.');
        return res.status(500).send('OS7 OAuth login failed.');
      }
    });
  }
};

function setDirectusOnboardingCookies(res, env) {
  const options = {
    path: '/',
    sameSite: env.SESSION_COOKIE_SAME_SITE || 'lax',
    secure: readBoolean(env.SESSION_COOKIE_SECURE),
    maxAge: 30 * 24 * 60 * 60 * 1000
  };

  for (const name of [
    'license-banner-dismissed',
    'license-onboarding-dismissed',
    'license-login-modal-dismissed'
  ]) {
    res.cookie(name, 'true', options);
  }
}

function readConfig(env) {
  const publicUrl = env.PUBLIC_URL || env.OS7_OAUTH_PUBLIC_URL;
  const clientId = env.OS7_OAUTH_CLIENT_ID;
  const clientSecret = env.OS7_OAUTH_CLIENT_SECRET;
  const authorizeUrl = env.OS7_OAUTH_AUTHORIZE_URL;
  const tokenUrl = env.OS7_OAUTH_TOKEN_URL;
  const userinfoUrl = env.OS7_OAUTH_USERINFO_URL;
  const secret = env.SECRET || clientSecret;

  if (
    !publicUrl ||
    !clientId ||
    !clientSecret ||
    !authorizeUrl ||
    !tokenUrl ||
    !userinfoUrl ||
    !secret
  ) {
    return null;
  }

  return {
    authorizeUrl,
    clientId,
    clientSecret,
    defaultRoleId: env.OS7_OAUTH_DEFAULT_ROLE_ID,
    publicUrl,
    scope: env.OS7_OAUTH_SCOPE || 'email profile',
    secret,
    tokenUrl,
    userinfoUrl
  };
}

function safeRedirect(input) {
  if (typeof input !== 'string' || !input.startsWith('/')) {
    return '/admin';
  }

  return input.startsWith('//') ? '/admin' : input;
}

function createCallbackUrl(publicUrl) {
  return new URL('/os7/callback', publicUrl).toString();
}

function readBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return String(value).toLowerCase() === 'true';
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');

  return `${encoded}.${signature}`;
}

function verifyState(state, secret) {
  const [encoded, signature] = state.split('.', 2);
  if (!encoded || !signature) {
    return null;
  }

  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function exchangeCode({ code, config, redirectUri }) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  const response = await fetch(config.tokenUrl, {
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`OS7 token exchange failed with ${response.status}`);
  }

  return response.json();
}

async function fetchProfile(userinfoUrl, accessToken) {
  const response = await fetch(userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`OS7 profile request failed with ${response.status}`);
  }

  return response.json();
}

async function resolveRoleId(database, configuredRoleId) {
  if (configuredRoleId) {
    const role = await database('directus_roles').select('id').where({ id: configuredRoleId }).first();
    if (role) {
      return role.id;
    }
  }

  const adminRole = await database('directus_roles')
    .select('id')
    .where({ name: 'Administrator' })
    .first();

  return adminRole?.id ?? configuredRoleId ?? null;
}

async function ensureDirectusUser({ database, email, name, password, role, schema, services }) {
  const existing = await database('directus_users')
    .select('id')
    .whereRaw('LOWER(??) = ?', ['email', email.toLowerCase()])
    .first();
  const { UsersService } = services;
  const users = new UsersService({
    accountability: { admin: true },
    knex: database,
    schema
  });
  const [firstName, ...lastNameParts] = name.split(/\s+/).filter(Boolean);
  const payload = {
    email,
    first_name: firstName || email,
    last_name: lastNameParts.join(' ') || null,
    password,
    role,
    status: 'active'
  };

  if (existing) {
    await users.updateOne(existing.id, payload);
    return existing.id;
  }

  return users.createOne(payload);
}
