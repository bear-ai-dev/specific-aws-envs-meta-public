// auth/oidc.strategy.ts
import { UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Client, UserinfoResponse, TokenSet, Issuer } from 'openid-client';

export const buildOpenIdClient = async () => {
    const TrustIssuer = await Issuer.discover(`https://auth.meteringco.example/.well-known/openid-configuration`);
    const client = new TrustIssuer.Client({
        client_id: `${process.env.METERINGCO_DASHBOARD_CLIENT_ID}`,
        client_secret: `${process.env.METERINGCO_DASHBOARD_CLIENT_SECRET}`,
    });
    return client;
};

export class OidcStrategy extends PassportStrategy(Strategy, 'oidc') {
    client: Client;
    constructor(client: Client) {
        super({
            client: client,
            params: {
                redirect_uri: `${process.env.METERINGCO_URL}/users/redirect`,
            },
            passReqToCallback: false,
            usePKCE: false,
        });

        this.client = client;
    }

    async validate(tokenset: TokenSet): Promise<any> {
        const userinfo: UserinfoResponse = await this.client.userinfo(tokenset);

        try {
            const id_token = tokenset.id_token;
            const access_token = tokenset.access_token;
            const refresh_token = tokenset.refresh_token;
            const user = {
                id_token,
                access_token,
                refresh_token,
                ...userinfo,
            };
            return user;
        } catch (err) {
            throw new UnauthorizedException();
        }
    }
}
//
