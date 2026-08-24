import { ApiProperty } from '@nestjs/swagger';

export class CustomerAuthenticationTokenResponse {
    /***
     * An JWT authentication token which specific customers can use to access their billing data from MeteringCo.
     * <br><br>
     *
     * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
     */
    @ApiProperty({ externalDocs: { description: 'Read more about JWTs', url: 'https://jwt.io/introduction/' } })
    public access_token: string;
}
