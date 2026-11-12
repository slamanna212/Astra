import { useQuery } from '@tanstack/react-query';
import { listProfiles } from '../../../api/profiles';
import { queryKeys } from '../../../api/queryKeys';
import { BrandMark } from '../../../components/BrandMark';
import { currentProfile } from '../../../lib/profileScope';
import classes from './Transcript.module.css';

/** A conversation with nothing in it yet: the mark and a prompt naming the bot that will answer. */
export function EmptyChat() {
  // Same roster query (and cache) as the composer's bot picker.
  const roster = useQuery({
    queryKey: queryKeys.profiles.list,
    queryFn: ({ signal }) => listProfiles(signal),
    staleTime: 30_000,
  });
  const bot = roster.data?.items.find((row) => row.name === currentProfile);
  return (
    <div className={classes.emptyChat}>
      <BrandMark size={40} />
      <div className={classes.emptyPrompt}>What should {bot?.title ?? 'Hermes'} work on?</div>
    </div>
  );
}
