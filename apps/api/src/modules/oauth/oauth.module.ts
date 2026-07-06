import { Module } from '@nestjs/common';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { GithubProvider } from './github.provider';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // JwtModule + AuthService (CryptoModule/FeatureFlags là @Global)
  controllers: [OauthController],
  providers: [OauthService, GithubProvider],
})
export class OauthModule {}
