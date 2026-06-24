import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type {
  AuthResponse,
  LoginDto,
  MeResponse,
  RegisterDto,
  UserDto,
} from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'team'
  );
}

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const required = this.config.get<string>('SIGNUP_CODE', '');
    if (required && dto.signupCode !== required) {
      throw new ForbiddenException(
        'Mã mời không đúng — liên hệ admin để được cấp',
      );
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email: dto.email, name: dto.name, passwordHash },
      });
      const base = slugify(dto.name ?? dto.email.split('@')[0]);
      const team = await tx.team.create({
        data: {
          name: dto.name ? `${dto.name}'s Team` : 'My Team',
          slug: `${base}-${u.id.slice(-6)}`,
        },
      });
      await tx.teamMember.create({
        data: { teamId: team.id, userId: u.id, role: 'OWNER' },
      });
      return u;
    });

    return {
      user: this.toUserDto(user),
      accessToken: this.sign(user.id, user.email),
    };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    return {
      user: this.toUserDto(user),
      accessToken: this.sign(user.id, user.email),
    };
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: { team: true },
    });
    return {
      user: this.toUserDto(user),
      teams: memberships.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        slug: m.team.slug,
        role: m.role,
      })),
    };
  }

  private sign(sub: string, email: string): string {
    return this.jwt.sign({ sub, email });
  }

  private toUserDto(u: UserRow): UserDto {
    return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl };
  }
}
