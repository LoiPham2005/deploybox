import { cookies } from 'next/headers';
import type { TeamDto } from '@deploybox/shared';

export function getSelectedTeam(teams: TeamDto[]): TeamDto {
  const selected = cookies().get('db_team')?.value;
  return teams.find(t => t.id === selected) ?? teams[0];
}
