import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { LocalJWTAuthService } from './jwt-local.strategy.js';
import { JwtStrategy } from './jwt.strategy.js';
import { OidcStrategy, buildOpenIdClient } from './oidc.strategy.js';
import { SessionSerializer } from './sessionSerializer.js';

const OidcStrategyFactory = {
    provide: 'OidcStrategy',
    useFactory: async () => {
        const client = await buildOpenIdClient(); // secret sauce! build the dynamic client before injecting it into the strategy for use in the constructor super call.
        const strategy = new OidcStrategy(client);
        return strategy;
    },
};
const ONE_WEEK_IN_MS = '604800000';
@Module({
    imports: [
        PassportModule.register({ session: true, defaultStrategy: ['jwt', 'oidc'] }),
        JwtModule.register({
            global: true,
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: ONE_WEEK_IN_MS },
        }),
    ],
    providers: [JwtStrategy, OidcStrategyFactory, SessionSerializer, LocalJWTAuthService],
    exports: [PassportModule, LocalJWTAuthService],
})
export class AuthzModule {}
