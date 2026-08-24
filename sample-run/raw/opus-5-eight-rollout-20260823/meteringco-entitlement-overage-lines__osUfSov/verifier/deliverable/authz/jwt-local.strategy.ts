import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
@Injectable()
export class LocalJWTAuthService {
    constructor(private jwtService: JwtService) {}

    async signIn(SaaSCustomerId: string, businessID: string) {
        const payload = { sub: SaaSCustomerId, businessID };
        return {
            access_token: await this.jwtService.signAsync(payload, { secret: process.env.JWT_SECRET }),
        };
    }

    async signInBusiness(subject: string, businessID: string) {
        const payload = { businessID, sub: subject };
        return {
            access_token: await this.jwtService.signAsync(payload, { secret: process.env.JWT_SECRET }),
        };
    }

    async generateStripeState(subject: string, businessID: string) {
        const payload = { sub: subject, businessID };
        return {
            access_token: await this.jwtService.signAsync(payload, { secret: process.env.JWT_SECRET }),
        };
    }
    async generateCustomerTokenWithInvoiceId(subject: string, businessID: string, invoiceId: string) {
        const payload = { sub: subject, businessID, invoiceId };
        return {
            access_token: await this.jwtService.signAsync(payload, {
                secret: process.env.JWT_SECRET,
                expiresIn: '90d',
            }),
        };
    }
}
