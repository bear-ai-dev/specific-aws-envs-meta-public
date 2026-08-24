import { ApiProperty } from '@nestjs/swagger';

export class BusinessTokenAuthenticationResponse {
    /***
     * A JWT authentication token which can be used to securely share selected business data with external parties.
     * <br><br>
     *
     * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
     */
    @ApiProperty({ externalDocs: { description: 'Read more about JWTs', url: 'https://jwt.io/introduction/' } })
    public access_token: string;
}
