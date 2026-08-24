import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    private static readonly logger = new Logger(JwtStrategy.name);
    constructor() {
        super({
            secretOrKeyProvider: passportJwtSecret({
                cache: true,
                rateLimit: true,
                jwksRequestsPerMinute: 5,
                jwksUri: `https://auth.meteringco.example/.well-known/jwks.json`,
            }),
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            audience: [
                process.env.AUTH0_AUDIENCE,
                'RA7Lh6NtIOw8dUC0E9DZpeqwakIygfhL',
                'https://example1234.execute-api.us-east-1.amazonaws.com',
                'https://example-tenant.us.auth0.com/userinfo',
            ],
            issuer: 'https://auth.meteringco.example/',
            algorithms: ['RS256'],
        });
    }

    validate(payload: any): any {
        return payload;
    }
}
